# humanovo Bootstrap - IAM User and Initial Setup
# Run this first to create an IAM user for deploying the full infrastructure
#
# Usage:
#   cd infrastructure/terraform/bootstrap
#   terraform init
#   terraform apply
#
# After apply, configure AWS CLI with the output credentials:
#   aws configure --profile humanovo-admin

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
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "humanovo"
      ManagedBy = "Terraform-Bootstrap"
    }
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "user_name" {
  description = "IAM user name"
  type        = string
  default     = "humanovo-admin"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

# Random suffix for unique names
resource "random_id" "suffix" {
  byte_length = 4
}

# ==================== IAM User ====================

resource "aws_iam_user" "humanovo_admin" {
  name = var.user_name
  path = "/humanovo/"

  tags = {
    Name        = var.user_name
    Purpose     = "humanovo deployment and administration"
    Environment = var.environment
  }
}

# Programmatic access key
resource "aws_iam_access_key" "humanovo_admin" {
  user = aws_iam_user.humanovo_admin.name
}

# Console login profile
resource "aws_iam_user_login_profile" "humanovo_admin" {
  user                    = aws_iam_user.humanovo_admin.name
  password_reset_required = true
}

# ==================== IAM Policy ====================

resource "aws_iam_user_policy" "humanovo_admin_full" {
  name = "${var.user_name}-full-access"
  user = aws_iam_user.humanovo_admin.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Full access to humanovo resources (scoped by naming convention)
      {
        Sid    = "humanovoLambdaFunctions"
        Effect = "Allow"
        Action = ["lambda:*"]
        Resource = [
          "arn:aws:lambda:*:*:function:humanovo-*"
        ]
      },
      {
        Sid    = "humanovoLambdaLayers"
        Effect = "Allow"
        Action = ["lambda:*"]
        Resource = [
          "arn:aws:lambda:*:*:layer:humanovo-*",
          "arn:aws:lambda:*:*:layer:humanovo-*:*"
        ]
      },
      {
        Sid    = "humanovoLambdaGlobal"
        Effect = "Allow"
        Action = [
          "lambda:CreateEventSourceMapping",
          "lambda:DeleteEventSourceMapping",
          "lambda:GetEventSourceMapping",
          "lambda:ListEventSourceMappings",
          "lambda:UpdateEventSourceMapping",
          "lambda:ListFunctions",
          "lambda:ListLayers",
          "lambda:GetAccountSettings",
          "lambda:PublishLayerVersion"
        ]
        Resource = "*"
      },
      {
        Sid    = "humanovoAPIGateway"
        Effect = "Allow"
        Action = ["apigateway:*"]
        Resource = "*"
      },
      {
        Sid    = "humanovoS3"
        Effect = "Allow"
        Action = ["s3:*"]
        Resource = [
          "arn:aws:s3:::humanovo-*",
          "arn:aws:s3:::humanovo-*/*"
        ]
      },
      {
        Sid    = "humanovoS3List"
        Effect = "Allow"
        Action = ["s3:ListAllMyBuckets", "s3:GetBucketLocation"]
        Resource = "*"
      },
      {
        Sid    = "humanovoDynamoDB"
        Effect = "Allow"
        Action = ["dynamodb:*"]
        Resource = "arn:aws:dynamodb:*:*:table/humanovo-*"
      },
      {
        Sid    = "humanovoDynamoDBList"
        Effect = "Allow"
        Action = ["dynamodb:ListTables", "dynamodb:DescribeLimits"]
        Resource = "*"
      },
      {
        Sid    = "humanovoCloudFront"
        Effect = "Allow"
        Action = ["cloudfront:*"]
        Resource = "*"
      },
      {
        Sid    = "humanovoCloudWatch"
        Effect = "Allow"
        Action = ["logs:*"]
        Resource = [
          "arn:aws:logs:*:*:log-group:/aws/lambda/humanovo-*",
          "arn:aws:logs:*:*:log-group:/aws/lambda/humanovo-*:*",
          "arn:aws:logs:*:*:log-group:/aws/apigateway/humanovo-*",
          "arn:aws:logs:*:*:log-group:/aws/apigateway/humanovo-*:*",
          "arn:aws:logs:*:*:log-group:/aws/humanovo/*",
          "arn:aws:logs:*:*:log-group:/aws/humanovo/*:*"
        ]
      },
      {
        Sid    = "humanovoCloudWatchList"
        Effect = "Allow"
        Action = ["logs:DescribeLogGroups"]
        Resource = "*"
      },
      {
        Sid    = "humanovoIAM"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:PassRole",
          "iam:UpdateRole",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:PutRolePolicy",
          "iam:GetRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:ListRoleTags",
          "iam:CreatePolicy",
          "iam:DeletePolicy",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListPolicyVersions",
          "iam:CreatePolicyVersion",
          "iam:DeletePolicyVersion",
          "iam:ListInstanceProfilesForRole"
        ]
        Resource = [
          "arn:aws:iam::*:role/humanovo-*",
          "arn:aws:iam::*:policy/humanovo-*"
        ]
      },
      {
        Sid    = "humanovoIAMList"
        Effect = "Allow"
        Action = [
          "iam:ListRoles",
          "iam:ListPolicies",
          "iam:GetAccountSummary"
        ]
        Resource = "*"
      },
      {
        Sid    = "humanovoKMS"
        Effect = "Allow"
        Action = [
          "kms:CreateKey",
          "kms:CreateAlias",
          "kms:DeleteAlias",
          "kms:DescribeKey",
          "kms:GetKeyPolicy",
          "kms:PutKeyPolicy",
          "kms:EnableKeyRotation",
          "kms:GetKeyRotationStatus",
          "kms:TagResource",
          "kms:UntagResource",
          "kms:ListResourceTags",
          "kms:ScheduleKeyDeletion",
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:GenerateDataKey",
          "kms:GenerateDataKeyWithoutPlaintext"
        ]
        Resource = "*"
      },
      {
        Sid    = "humanovoKMSList"
        Effect = "Allow"
        Action = ["kms:ListKeys", "kms:ListAliases"]
        Resource = "*"
      },
      {
        Sid    = "humanovoSecretsManager"
        Effect = "Allow"
        Action = ["secretsmanager:*"]
        Resource = "arn:aws:secretsmanager:*:*:secret:humanovo-*"
      },
      {
        Sid    = "humanovoSecretsManagerList"
        Effect = "Allow"
        Action = ["secretsmanager:ListSecrets"]
        Resource = "*"
      },
      {
        Sid    = "humanovoSQS"
        Effect = "Allow"
        Action = ["sqs:*"]
        Resource = "arn:aws:sqs:*:*:humanovo-*"
      },
      {
        Sid    = "humanovoSQSList"
        Effect = "Allow"
        Action = ["sqs:ListQueues"]
        Resource = "*"
      },
      {
        Sid    = "humanovoBedrock"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:ListFoundationModels",
          "bedrock:GetFoundationModel",
          "bedrock:ListModelInvocationJobs",
          "bedrock:GetModelInvocationJob"
        ]
        Resource = "*"
      },
      {
        Sid    = "humanovoWAF"
        Effect = "Allow"
        Action = ["wafv2:*"]
        Resource = "*"
      },
      {
        Sid    = "humanovoSTS"
        Effect = "Allow"
        Action = [
          "sts:GetCallerIdentity",
          "sts:GetAccessKeyInfo"
        ]
        Resource = "*"
      },
      {
        Sid    = "humanovoTagging"
        Effect = "Allow"
        Action = [
          "tag:GetResources",
          "tag:TagResources",
          "tag:UntagResources"
        ]
        Resource = "*"
      },
      {
        Sid    = "humanovoXRay"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets"
        ]
        Resource = "*"
      }
    ]
  })
}

# ==================== Terraform State Bucket (Optional) ====================

# Persistent state bucket — DO NOT RENAME; renaming orphans Terraform
# state. The legacy `genup-terraform-state-*` bucket is the backend for
# infrastructure/terraform/main.tf. The new-account migration path
# (humanovo-terraform-state in the security account) is tracked in
# docs/planning/REBRAND_RUNBOOK.md and applied via the
# bootstrap-backend-new-account.yml workflow.
resource "aws_s3_bucket" "terraform_state" {
  bucket = "genup-terraform-state-${random_id.suffix.hex}"

  tags = {
    Name    = "humanovo Terraform State"
    Purpose = "Terraform remote state storage"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# DynamoDB table for state locking
#
# Persistent state — DO NOT RENAME. The `genup-terraform-locks` table
# pairs with the legacy state bucket above. Renaming would break state
# locking against the existing state file. Migration tracked in
# docs/planning/REBRAND_RUNBOOK.md.
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "genup-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name    = "humanovo Terraform Locks"
    Purpose = "Terraform state locking"
  }
}

# ==================== Outputs ====================

output "aws_account_id" {
  description = "AWS Account ID"
  value       = data.aws_caller_identity.current.account_id
}

output "user_name" {
  description = "IAM user name"
  value       = aws_iam_user.humanovo_admin.name
}

output "user_arn" {
  description = "IAM user ARN"
  value       = aws_iam_user.humanovo_admin.arn
}

output "access_key_id" {
  description = "AWS Access Key ID"
  value       = aws_iam_access_key.humanovo_admin.id
}

output "secret_access_key" {
  description = "AWS Secret Access Key (sensitive)"
  value       = aws_iam_access_key.humanovo_admin.secret
  sensitive   = true
}

output "console_password" {
  description = "AWS Console Password (sensitive)"
  value       = aws_iam_user_login_profile.humanovo_admin.password
  sensitive   = true
}

output "console_login_url" {
  description = "AWS Console login URL"
  value       = "https://${data.aws_caller_identity.current.account_id}.signin.aws.amazon.com/console"
}

output "terraform_state_bucket" {
  description = "S3 bucket for Terraform state"
  value       = aws_s3_bucket.terraform_state.bucket
}

output "terraform_locks_table" {
  description = "DynamoDB table for Terraform locks"
  value       = aws_dynamodb_table.terraform_locks.name
}

output "aws_configure_commands" {
  description = "Commands to configure AWS CLI"
  value       = <<-EOT

    ================================================
    AWS CLI CONFIGURATION
    ================================================

    Run these commands to configure AWS CLI:

    aws configure --profile humanovo-admin
    # Enter Access Key ID: ${aws_iam_access_key.humanovo_admin.id}
    # Enter Secret Access Key: (run 'terraform output -raw secret_access_key')
    # Default region: ${var.aws_region}
    # Default output format: json

    Then use the profile:
    export AWS_PROFILE=humanovo-admin

    Or add to commands:
    aws s3 ls --profile humanovo-admin

    ================================================
    CONSOLE ACCESS
    ================================================

    Login URL: https://${data.aws_caller_identity.current.account_id}.signin.aws.amazon.com/console
    Username: ${aws_iam_user.humanovo_admin.name}
    Password: (run 'terraform output -raw console_password')

    ================================================
    TERRAFORM BACKEND CONFIG
    ================================================

    Add this to your main terraform configuration:

    terraform {
      backend "s3" {
        bucket         = "${aws_s3_bucket.terraform_state.bucket}"
        key            = "genup/terraform.tfstate"
        region         = "${var.aws_region}"
        dynamodb_table = "${aws_dynamodb_table.terraform_locks.name}"
        encrypt        = true
      }
    }

  EOT
}

data "aws_caller_identity" "current" {}
