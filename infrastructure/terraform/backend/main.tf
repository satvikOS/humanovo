# humanovo Backend stack — VPC + Aurora + ElastiCache + Lambda + API GW
#
# Single-file Terraform stack for the closed-beta production backend.
# Kept flat (no modules) on purpose: every resource is referenced from
# at most one or two other resources, so the indirection a module would
# add buys us nothing. Re-evaluate if/when we want a staging mirror.
#
# Cost notes (us-east-1, May 2026 pricing):
#   - VPC + 6 subnets + IGW: $0
#   - fck-nat t4g.nano (production_nat=false): ~$3/month
#   - Aurora Serverless v2 (0.5 ACU min): ~$43/month idle
#   - ElastiCache Serverless: ~$30/month minimum
#   - Lambda: pay per request — effectively $0 pre-revenue
#   - API Gateway HTTP API: $1 per million requests
#
# State backend is hardcoded here (not via -backend-config) because
# every closed-beta deploy lands in the same new account / same region.
# The bootstrap workflow ensures the bucket + DDB table exist first.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket         = "humanovo-tf-state-us-east-1"
    key            = "backend/prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "humanovo-tf-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "humanovo"
      Environment = "prod"
      ManagedBy   = "terraform"
      Stack       = "backend"
    }
  }
}

# ─── Locals ─────────────────────────────────────────────────────────

locals {
  name_prefix = "humanovo"
  environment = "prod"
  full_name   = "${local.name_prefix}-${local.environment}"

  # Two AZs, hardcoded suffixes (a, b). Aurora + ElastiCache subnet
  # groups need at least 2 AZs even if we only deploy a single writer
  # — the cluster_subnet_group is part of the cluster's HA story even
  # when we don't pre-provision a reader.
  azs = ["${var.aws_region}a", "${var.aws_region}b"]

  # Subnet CIDRs — three layers per AZ (public/private/isolated):
  #   AZ-a: 10.20.0.0/24, 10.20.1.0/24, 10.20.2.0/24
  #   AZ-b: 10.20.10.0/24, 10.20.11.0/24, 10.20.12.0/24
  vpc_cidr       = "10.20.0.0/16"
  public_cidrs   = ["10.20.0.0/24", "10.20.10.0/24"]
  private_cidrs  = ["10.20.1.0/24", "10.20.11.0/24"]
  isolated_cidrs = ["10.20.2.0/24", "10.20.12.0/24"]

  # Origins allowed to call the API. Tauri apps post from the magic
  # `tauri://localhost` origin which the v2 CORS spec accepts as a
  # literal string match (no wildcard tricks needed).
  cors_origins = [
    "https://www.humanovo.net",
    "https://d1l1516144ax30.cloudfront.net",
    "tauri://localhost",
  ]
}

data "aws_caller_identity" "current" {}

# ─── VPC ─────────────────────────────────────────────────────────────

resource "aws_vpc" "this" {
  cidr_block           = local.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.full_name}-vpc"
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${local.full_name}-igw"
  }
}

# ─── Subnets ────────────────────────────────────────────────────────

resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.full_name}-public-${substr(local.azs[count.index], -1, 1)}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${local.full_name}-private-${substr(local.azs[count.index], -1, 1)}"
    Tier = "private"
  }
}

resource "aws_subnet" "isolated" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.isolated_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${local.full_name}-isolated-${substr(local.azs[count.index], -1, 1)}"
    Tier = "isolated"
  }
}

# ─── NAT Layer (toggle: instance vs gateway) ────────────────────────

# fck-nat AMI lookup (only used when production_nat = false). The
# project ships official ARM64 AMIs in every region.
data "aws_ami" "fck_nat" {
  count       = var.production_nat ? 0 : 1
  most_recent = true
  owners      = ["568608671756"] # fck-nat publisher

  filter {
    name   = "name"
    values = ["fck-nat-al2023-*-arm64-ebs"]
  }
}

# Security group for the fck-nat instance — allows all egress and
# allows ingress from anywhere inside the VPC (so private subnets
# can route through it).
resource "aws_security_group" "fck_nat" {
  count       = var.production_nat ? 0 : 1
  name        = "${local.full_name}-fck-nat-sg"
  description = "fck-nat NAT instance traffic"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "All traffic from inside the VPC"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [local.vpc_cidr]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.full_name}-fck-nat-sg"
  }
}

resource "aws_network_interface" "fck_nat" {
  count             = var.production_nat ? 0 : 1
  subnet_id         = aws_subnet.public[0].id
  security_groups   = [aws_security_group.fck_nat[0].id]
  source_dest_check = false

  tags = {
    Name = "${local.full_name}-fck-nat-eni"
  }
}

resource "aws_instance" "fck_nat" {
  count         = var.production_nat ? 0 : 1
  ami           = data.aws_ami.fck_nat[0].id
  instance_type = "t4g.nano"

  network_interface {
    network_interface_id = aws_network_interface.fck_nat[0].id
    device_index         = 0
  }

  tags = {
    Name = "${local.full_name}-fck-nat"
  }
}

# Managed NAT Gateway — only when production_nat = true.
resource "aws_eip" "nat" {
  count  = var.production_nat ? 1 : 0
  domain = "vpc"

  tags = {
    Name = "${local.full_name}-nat-eip"
  }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count         = var.production_nat ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id

  tags = {
    Name = "${local.full_name}-nat"
  }

  depends_on = [aws_internet_gateway.this]
}

# ─── Route Tables ───────────────────────────────────────────────────

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = {
    Name = "${local.full_name}-rt-public"
  }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Single private route table — both AZs share it. We're saving the
# cost of a second NAT (gateway or instance) at the price of cross-AZ
# egress traffic going through AZ-a. Acceptable for closed beta.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id

  dynamic "route" {
    for_each = var.production_nat ? [1] : []
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = aws_nat_gateway.this[0].id
    }
  }

  dynamic "route" {
    for_each = var.production_nat ? [] : [1]
    content {
      cidr_block           = "0.0.0.0/0"
      network_interface_id = aws_network_interface.fck_nat[0].id
    }
  }

  tags = {
    Name = "${local.full_name}-rt-private"
  }
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Isolated subnets get a route table with no default route — they can
# only talk to other resources in the VPC. Aurora + ElastiCache live
# here so a misconfigured SG can't accidentally let them reach the
# public internet.
resource "aws_route_table" "isolated" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${local.full_name}-rt-isolated"
  }
}

resource "aws_route_table_association" "isolated" {
  count          = length(aws_subnet.isolated)
  subnet_id      = aws_subnet.isolated[count.index].id
  route_table_id = aws_route_table.isolated.id
}

# ─── Security Groups ────────────────────────────────────────────────

resource "aws_security_group" "lambda" {
  name        = "${local.full_name}-lambda-sg"
  description = "Lambda function ENIs — egress only"
  vpc_id      = aws_vpc.this.id

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.full_name}-lambda-sg"
  }
}

resource "aws_security_group" "rds_proxy" {
  name        = "${local.full_name}-rds-proxy-sg"
  description = "RDS Proxy — accepts 5432 from Lambda"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Postgres from Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.full_name}-rds-proxy-sg"
  }
}

resource "aws_security_group" "db" {
  name        = "${local.full_name}-db-sg"
  description = "Aurora cluster — accepts 5432 from Lambda + RDS Proxy"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Postgres from Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  ingress {
    description     = "Postgres from RDS Proxy"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds_proxy.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.full_name}-db-sg"
  }
}

resource "aws_security_group" "redis" {
  name        = "${local.full_name}-redis-sg"
  description = "ElastiCache — accepts 6379 from Lambda"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Redis from Lambda"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.full_name}-redis-sg"
  }
}

# ─── Secrets Manager ────────────────────────────────────────────────

# Aurora master password — generated, never typed by a human.
resource "random_password" "db_master" {
  length  = 40
  special = true
  # RDS rejects these characters in master passwords:
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "db" {
  name                    = "humanovo/prod/db"
  description             = "Aurora master credentials for humanovo-prod"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = "humanovo"
    password = random_password.db_master.result
    engine   = "postgres"
    host     = aws_rds_cluster.main.endpoint
    port     = 5432
    dbname   = "humanovo"
  })

  # Aurora cluster needs to exist before we can know its endpoint, but
  # the cluster also needs the secret password before it's created.
  # Solve via two-phase: cluster reads `random_password.db_master.result`
  # directly; the secret_version then back-fills the host once the
  # cluster's endpoint is known. Acceptable race: the very first apply
  # writes the secret with an empty host briefly, then updates it.
  depends_on = [aws_rds_cluster.main]
}

# Redis AUTH token — ElastiCache requires it for transit encryption.
resource "random_password" "redis_auth" {
  length  = 64
  special = false # ElastiCache AUTH tokens reject most special chars
}

resource "aws_secretsmanager_secret" "redis" {
  name                    = "humanovo/prod/redis"
  description             = "ElastiCache AUTH token for humanovo-prod"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id = aws_secretsmanager_secret.redis.id
  secret_string = jsonencode({
    auth_token = random_password.redis_auth.result
    host       = aws_elasticache_serverless_cache.main.endpoint[0].address
    port       = 6379
  })
}

# Application-level secrets (third-party API keys, JWT secret).
# JWT secret is generated; everything else is REPLACE_ME and the
# operator fills via the Secrets Manager console post-apply.
resource "random_id" "jwt_secret" {
  byte_length = 64
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "humanovo/prod/app"
  description             = "Application secrets — third-party API keys + JWT signing key"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    jwt_secret_key      = random_id.jwt_secret.hex
    stripe_secret_key   = "REPLACE_ME"
    anthropic_api_key   = "REPLACE_ME"
    openai_api_key      = "REPLACE_ME"
    auth0_domain        = ""
    auth0_client_id     = ""
    auth0_client_secret = ""
  })

  # The operator will edit the JSON via the console post-apply to fill
  # the REPLACE_ME values; we don't want every terraform apply to clobber
  # those edits. ignore_changes covers it.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ─── Aurora Serverless v2 ───────────────────────────────────────────

resource "aws_db_subnet_group" "aurora" {
  name        = "${local.full_name}-aurora-subnets"
  description = "Aurora cluster subnet group — isolated tier only"
  subnet_ids  = aws_subnet.isolated[*].id
}

resource "aws_rds_cluster" "main" {
  cluster_identifier = "${local.full_name}-aurora"
  engine             = "aurora-postgresql"
  # 16.x — major version is what AWS will minor-bump for us.
  engine_version = "16.4"

  database_name   = "humanovo"
  master_username = "humanovo"
  master_password = random_password.db_master.result

  db_subnet_group_name   = aws_db_subnet_group.aurora.name
  vpc_security_group_ids = [aws_security_group.db.id]
  storage_encrypted      = true

  serverlessv2_scaling_configuration {
    min_capacity = 0.5
    max_capacity = 4.0
  }

  backup_retention_period = 7
  preferred_backup_window = "07:00-08:00" # UTC, low-traffic window

  deletion_protection = true
  skip_final_snapshot = false
  # Final snapshot ID must be unique forever; embedding the cluster
  # id + a fixed suffix is enough as long as we don't replace the
  # cluster more than once.
  final_snapshot_identifier = "${local.full_name}-aurora-final"

  apply_immediately = true

  lifecycle {
    # If the operator rotates the secret manually, we don't want
    # terraform apply to revert it to the random_password value.
    ignore_changes = [master_password]
  }
}

resource "aws_rds_cluster_instance" "writer" {
  identifier         = "${local.full_name}-aurora-writer"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version

  publicly_accessible = false
  apply_immediately   = true
}

# ─── RDS Proxy ──────────────────────────────────────────────────────

resource "aws_iam_role" "rds_proxy" {
  name = "${local.full_name}-rds-proxy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

data "aws_iam_policy_document" "rds_proxy_secrets" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [aws_secretsmanager_secret.db.arn]
  }
  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "rds_proxy_secrets" {
  name   = "${local.full_name}-rds-proxy-secrets"
  role   = aws_iam_role.rds_proxy.id
  policy = data.aws_iam_policy_document.rds_proxy_secrets.json
}

resource "aws_db_proxy" "main" {
  name                   = "${local.full_name}-rds-proxy"
  engine_family          = "POSTGRESQL"
  idle_client_timeout    = 1800
  require_tls            = true
  role_arn               = aws_iam_role.rds_proxy.arn
  vpc_security_group_ids = [aws_security_group.rds_proxy.id]
  vpc_subnet_ids         = aws_subnet.isolated[*].id

  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "DISABLED"
    secret_arn  = aws_secretsmanager_secret.db.arn
  }

  depends_on = [aws_secretsmanager_secret_version.db]
}

resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name

  connection_pool_config {
    max_connections_percent      = 100
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 120
  }
}

resource "aws_db_proxy_target" "main" {
  db_proxy_name         = aws_db_proxy.main.name
  target_group_name     = aws_db_proxy_default_target_group.main.name
  db_cluster_identifier = aws_rds_cluster.main.id
}

# ─── ElastiCache Serverless ─────────────────────────────────────────

resource "aws_elasticache_serverless_cache" "main" {
  engine = "redis"
  name   = "${local.full_name}-redis"

  # Limit caps so an accidental hot loop can't bankrupt us. Closed
  # beta sees ~50MB of working set; 5GB ceiling is hilariously safe.
  cache_usage_limits {
    data_storage {
      maximum = 5
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = 5000
    }
  }

  daily_snapshot_time  = "03:00"
  description          = "humanovo prod cache"
  major_engine_version = "7"
  security_group_ids   = [aws_security_group.redis.id]
  subnet_ids           = aws_subnet.isolated[*].id

  # Encryption at rest is on by default for Serverless; transit is
  # always-on. AUTH token wires up the client-side check.
  user_group_id = aws_elasticache_user_group.main.user_group_id
}

# ElastiCache user + group required for AUTH token auth on serverless.
resource "aws_elasticache_user" "default" {
  user_id       = "${local.full_name}-default"
  user_name     = "default"
  access_string = "on ~* +@all"
  engine        = "REDIS"

  authentication_mode {
    type      = "password"
    passwords = [random_password.redis_auth.result]
  }
}

resource "aws_elasticache_user_group" "main" {
  engine        = "REDIS"
  user_group_id = "${local.full_name}-redis-ug"
  user_ids      = [aws_elasticache_user.default.user_id]
}

# ─── ECR ────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "backend" {
  name                 = "humanovo-backend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# ─── Lambda ─────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${local.full_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "lambda_inline" {
  statement {
    sid    = "ReadAppSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_secretsmanager_secret.app.arn,
      aws_secretsmanager_secret.db.arn,
      aws_secretsmanager_secret.redis.arn,
    ]
  }

  statement {
    sid    = "InvokeBedrockModels"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda_inline" {
  name   = "${local.full_name}-lambda-inline"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_inline.json
}

# Image URI resolution:
#   - if the operator passed lambda_image_uri, use it
#   - else if a `:bootstrap` tag exists in ECR, use ECR repo @ :bootstrap
#   - else fall back to the public Lambda Python base image so the
#     very first apply doesn't deadlock waiting for an image that
#     hasn't been built yet.
locals {
  lambda_image = (
    var.lambda_image_uri != null ? var.lambda_image_uri : "public.ecr.aws/lambda/python:3.12"
  )
}

resource "aws_lambda_function" "backend" {
  function_name = "humanovo-backend-prod"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = local.lambda_image

  memory_size   = 2048
  timeout       = 30
  architectures = ["x86_64"]

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      SECRETS_MANAGER_NAME = aws_secretsmanager_secret.app.name
      DB_SECRET_NAME       = aws_secretsmanager_secret.db.name
      REDIS_SECRET_NAME    = aws_secretsmanager_secret.redis.name
      RDS_PROXY_HOST       = aws_db_proxy.main.endpoint
      REDIS_HOST           = aws_elasticache_serverless_cache.main.endpoint[0].address
      AWS_REGION           = var.aws_region
    }
  }

  # Once the deploy workflow starts pushing real images, terraform
  # apply should not flap the function back to the placeholder. The
  # workflow updates image_uri via `aws lambda update-function-code`.
  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_vpc,
    aws_iam_role_policy.lambda_inline,
  ]
}

# ─── API Gateway HTTP API v2 ────────────────────────────────────────

resource "aws_apigatewayv2_api" "main" {
  name          = "${local.full_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = true
    allow_origins     = local.cors_origins
    allow_methods     = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    # Explicit allowlist — `["*"]` is incompatible with allow_credentials=true
    # in modern browsers anyway and signals "we don't know what we accept" to
    # security scanners. Add new headers here as the API surface grows.
    allow_headers = [
      "Accept",
      "Accept-Language",
      "Authorization",
      "Cache-Control",
      "Content-Language",
      "Content-Type",
      "Idempotency-Key",
      "Origin",
      "Stripe-Signature",
      "X-Admin-Secret",
      "X-Request-Id",
      "X-Requested-With",
    ]
    expose_headers = [
      "X-Request-Id",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "Retry-After",
    ]
    max_age = 3600
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backend.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 1000
    throttling_rate_limit  = 500
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ─── ACM + Custom Domain ────────────────────────────────────────────

data "aws_route53_zone" "primary" {
  name = "humanovo.net"
}

resource "aws_acm_certificate" "api" {
  domain_name       = "api.humanovo.net"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.primary.zone_id
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.api_validation : r.fqdn]
}

resource "aws_apigatewayv2_domain_name" "api" {
  domain_name = "api.humanovo.net"

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.api.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "api" {
  api_id      = aws_apigatewayv2_api.main.id
  domain_name = aws_apigatewayv2_domain_name.api.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "api_a" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "api.humanovo.net"
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api_aaaa" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "api.humanovo.net"
  type    = "AAAA"

  alias {
    name                   = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# ─── Outputs ────────────────────────────────────────────────────────

output "api_gateway_url" {
  description = "Default invoke URL (regional, *.execute-api.<region>.amazonaws.com). Use this for direct testing."
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "api_gateway_custom_domain" {
  description = "Custom api.humanovo.net URL — what the frontend talks to in prod."
  value       = "https://${aws_apigatewayv2_domain_name.api.domain_name}"
}

output "lambda_function_name" {
  description = "Lambda function name — used by the deploy workflow's update-function-code call."
  value       = aws_lambda_function.backend.function_name
}

output "lambda_function_arn" {
  description = "Lambda function ARN."
  value       = aws_lambda_function.backend.arn
}

output "ecr_repository_url" {
  description = "ECR URL for `docker push`."
  value       = aws_ecr_repository.backend.repository_url
}

output "aurora_cluster_endpoint" {
  description = "RDS Proxy endpoint — Lambda connects here, NOT directly to the Aurora cluster."
  value       = aws_db_proxy.main.endpoint
}

output "redis_endpoint" {
  description = "ElastiCache Serverless endpoint hostname."
  value       = aws_elasticache_serverless_cache.main.endpoint[0].address
}

output "secrets_manager_app_name" {
  description = "Application secrets blob — the operator edits this post-apply to fill REPLACE_ME values."
  value       = aws_secretsmanager_secret.app.name
}

output "vpc_id" {
  description = "VPC ID — surfaced for cross-stack references / debugging."
  value       = aws_vpc.this.id
}

output "lambda_security_group_id" {
  description = "Lambda SG ID — useful when granting other resources ingress from Lambda."
  value       = aws_security_group.lambda.id
}
