# GenUp AWS Infrastructure - Main Configuration
# Serverless architecture with Lambda, API Gateway, CloudFront, Bedrock

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # S3 backend for remote state management
  # This enables consistent state across CI/CD runs
  backend "s3" {
    bucket         = "genup-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "genup-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "GenUp"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Owner       = var.owner
    }
  }
}

# Provider for CloudFront (must be us-east-1 for ACM certificates)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "GenUp"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Owner       = var.owner
    }
  }
}

# Fixed suffix for consistent resource names across deployments
# Using environment-based suffix instead of random to ensure bucket names stay the same
locals {
  name_prefix = "genup-${var.environment}"
  # Fixed suffix based on environment - ensures same bucket names every deployment
  suffix      = var.environment

  common_tags = {
    Project     = "GenUp"
    Environment = var.environment
  }
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# KMS Key for encryption
resource "aws_kms_key" "main" {
  description             = "GenUp ${var.environment} encryption key"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow Lambda to use the key"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey*"
        ]
        Resource = "*"
      },
      {
        Sid    = "Allow CloudWatch Logs to use the key"
        Effect = "Allow"
        Principal = {
          Service = "logs.${var.aws_region}.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"
          }
        }
      },
      {
        Sid    = "Allow DynamoDB to use the key"
        Effect = "Allow"
        Principal = {
          Service = "dynamodb.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
          "kms:CreateGrant"
        ]
        Resource = "*"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-kms"
  }
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name_prefix}"
  target_key_id = aws_kms_key.main.key_id

  lifecycle {
    create_before_destroy = false
    # If alias already exists, just update it to point to our key
    ignore_changes = []
  }
}

# Secrets Manager for API keys
resource "aws_secretsmanager_secret" "api_keys" {
  name                    = "${local.name_prefix}-api-keys-${local.suffix}"
  description             = "GenUp API keys and secrets"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = var.environment == "prod" ? 30 : 0

  tags = {
    Name = "${local.name_prefix}-api-keys"
  }
}

resource "aws_secretsmanager_secret_version" "api_keys" {
  secret_id = aws_secretsmanager_secret.api_keys.id
  secret_string = jsonencode({
    OPENAI_API_KEY     = var.openai_api_key
    GOOGLE_API_KEY     = var.google_api_key
    BRAVE_API_KEY      = var.brave_api_key
    PUBMED_API_KEY     = var.pubmed_api_key
    JWT_SECRET         = var.jwt_secret != "" ? var.jwt_secret : "genup-jwt-${var.environment}-secret"
  })
}

# CloudWatch Log Group for centralized logging
resource "aws_cloudwatch_log_group" "main" {
  name              = "/aws/genup/${var.environment}"
  retention_in_days = var.log_retention_days
  # Using default encryption to avoid KMS permission complexity
  # kms_key_id        = aws_kms_key.main.arn

  tags = {
    Name = "${local.name_prefix}-logs"
  }
}

# Include sub-modules
module "iam" {
  source = "./modules/iam"

  name_prefix    = local.name_prefix
  environment    = var.environment
  aws_region     = var.aws_region
  account_id     = data.aws_caller_identity.current.account_id
  kms_key_arn    = aws_kms_key.main.arn
  secrets_arn    = aws_secretsmanager_secret.api_keys.arn

  s3_bucket_arns = [
    module.s3.frontend_bucket_arn,
    module.s3.data_bucket_arn,
    module.s3.artifacts_bucket_arn,
  ]

  dynamodb_table_arns = [
    module.dynamodb.projects_table_arn,
    module.dynamodb.hypotheses_table_arn,
    module.dynamodb.evidence_table_arn,
    module.dynamodb.simulations_table_arn,
  ]
}

module "s3" {
  source = "./modules/s3"

  name_prefix = local.name_prefix
  suffix      = local.suffix
  environment = var.environment
  kms_key_arn = aws_kms_key.main.arn
}

module "dynamodb" {
  source = "./modules/dynamodb"

  name_prefix = local.name_prefix
  environment = var.environment
  kms_key_arn = aws_kms_key.main.arn
}

module "lambda" {
  source = "./modules/lambda"

  name_prefix         = local.name_prefix
  suffix              = local.suffix
  environment         = var.environment
  aws_region          = var.aws_region
  account_id          = data.aws_caller_identity.current.account_id
  kms_key_arn         = aws_kms_key.main.arn
  secrets_arn         = aws_secretsmanager_secret.api_keys.arn
  lambda_role_arn     = module.iam.lambda_execution_role_arn
  log_group_name      = aws_cloudwatch_log_group.main.name

  # DynamoDB tables
  projects_table_name    = module.dynamodb.projects_table_name
  hypotheses_table_name  = module.dynamodb.hypotheses_table_name
  evidence_table_name    = module.dynamodb.evidence_table_name
  simulations_table_name = module.dynamodb.simulations_table_name

  # S3 buckets
  data_bucket_name      = module.s3.data_bucket_name
  artifacts_bucket_name = module.s3.artifacts_bucket_name

  # Configuration
  bedrock_model_id      = var.bedrock_model_id
  bedrock_embedding_model_id = var.bedrock_embedding_model_id
  lambda_memory_size    = var.lambda_memory_size
  lambda_timeout        = var.lambda_timeout
}

module "api_gateway" {
  source = "./modules/api_gateway"

  name_prefix    = local.name_prefix
  environment    = var.environment
  aws_region     = var.aws_region

  # Lambda integrations
  lambda_functions = module.lambda.function_arns
  lambda_invoke_arns = module.lambda.invoke_arns

  # CORS
  cors_allowed_origins = var.cors_allowed_origins

  # Auth
  enable_jwt_auth = var.enable_jwt_auth
  jwt_issuer      = var.jwt_issuer
  jwt_audience    = var.jwt_audience
}

module "cloudfront" {
  source = "./modules/cloudfront"

  providers = {
    aws = aws.us_east_1
  }

  name_prefix           = local.name_prefix
  suffix                = local.suffix
  environment           = var.environment
  frontend_bucket_id    = module.s3.frontend_bucket_id
  frontend_bucket_arn   = module.s3.frontend_bucket_arn
  frontend_bucket_domain = module.s3.frontend_bucket_regional_domain
  api_gateway_endpoint  = module.api_gateway.api_endpoint
  api_gateway_id        = module.api_gateway.api_id

  domain_name           = var.domain_name
  certificate_arn       = var.acm_certificate_arn

  waf_enabled           = var.waf_enabled
  price_class           = var.cloudfront_price_class
}

# Outputs
output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = module.cloudfront.distribution_id
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name"
  value       = module.cloudfront.domain_name
}

output "api_gateway_endpoint" {
  description = "API Gateway endpoint URL"
  value       = module.api_gateway.api_endpoint
}

output "api_gateway_stage_url" {
  description = "API Gateway stage URL"
  value       = module.api_gateway.stage_url
}

output "frontend_bucket_name" {
  description = "S3 bucket for frontend assets"
  value       = module.s3.frontend_bucket_name
}

output "data_bucket_name" {
  description = "S3 bucket for data storage"
  value       = module.s3.data_bucket_name
}

output "artifacts_bucket_name" {
  description = "S3 bucket for build artifacts"
  value       = module.s3.artifacts_bucket_name
}

output "lambda_function_names" {
  description = "Lambda function names"
  value       = module.lambda.function_names
}
