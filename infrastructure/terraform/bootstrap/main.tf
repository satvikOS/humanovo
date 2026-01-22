# GenUp Bootstrap - IAM User and Initial Setup
# Run this first to create an IAM user for deploying the full infrastructure
#
# Usage:
#   cd infrastructure/terraform/bootstrap
#   terraform init
#   terraform apply
#
# After apply, configure AWS CLI with the output credentials:
#   aws configure --profile genup-admin

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
      Project   = "GenUp"
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
  default     = "genup-admin"
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

resource "aws_iam_user" "genup_admin" {
  name = var.user_name
  path = "/genup/"

  tags = {
    Name        = var.user_name
    Purpose     = "GenUp deployment and administration"
    Environment = var.environment
  }
}

# Programmatic access key
resource "aws_iam_access_key" "genup_admin" {
  user = aws_iam_user.genup_admin.name
}

# Console login profile
resource "aws_iam_user_login_profile" "genup_admin" {
  user                    = aws_iam_user.genup_admin.name
  password_reset_required = true
}

# ==================== IAM Policy ====================

resource "aws_iam_user_policy" "genup_admin_full" {
  name = "${var.user_name}-full-access"
  user = aws_iam_user.genup_admin.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Full access to GenUp resources (scoped by naming convention)
      {
        Sid    = "GenUpLambdaFunctions"
        Effect = "Allow"
        Action = ["lambda:*"]
        Resource = [
          "arn:aws:lambda:*:*:function:genup-*"
        ]
      },
      {
        Sid    = "GenUpLambdaLayers"
        Effect = "Allow"
        Action = ["lambda:*"]
        Resource = [
          "arn:aws:lambda:*:*:layer:genup-*",
          "arn:aws:lambda:*:*:layer:genup-*:*"
        ]
      },
      {
        Sid    = "GenUpLambdaGlobal"
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
        Sid    = "GenUpAPIGateway"
        Effect = "Allow"
        Action = ["apigateway:*"]
        Resource = "*"
      },
      {
        Sid    = "GenUpS3"
        Effect = "Allow"
        Action = ["s3:*"]
        Resource = [
          "arn:aws:s3:::genup-*",
          "arn:aws:s3:::genup-*/*"
        ]
      },
      {
        Sid    = "GenUpS3List"
        Effect = "Allow"
        Action = ["s3:ListAllMyBuckets", "s3:GetBucketLocation"]
        Resource = "*"
      },
      {
        Sid    = "GenUpDynamoDB"
        Effect = "Allow"
        Action = ["dynamodb:*"]
        Resource = "arn:aws:dynamodb:*:*:table/genup-*"
      },
      {
        Sid    = "GenUpDynamoDBList"
        Effect = "Allow"
        Action = ["dynamodb:ListTables", "dynamodb:DescribeLimits"]
        Resource = "*"
      },
      {
        Sid    = "GenUpCloudFront"
        Effect = "Allow"
        Action = ["cloudfront:*"]
        Resource = "*"
      },
      {
        Sid    = "GenUpCloudWatch"
        Effect = "Allow"
        Action = ["logs:*"]
        Resource = [
          "arn:aws:logs:*:*:log-group:/aws/lambda/genup-*",
          "arn:aws:logs:*:*:log-group:/aws/lambda/genup-*:*",
          "arn:aws:logs:*:*:log-group:/aws/apigateway/genup-*",
          "arn:aws:logs:*:*:log-group:/aws/apigateway/genup-*:*",
          "arn:aws:logs:*:*:log-group:/aws/genup/*",
          "arn:aws:logs:*:*:log-group:/aws/genup/*:*"
        ]
      },
      {
        Sid    = "GenUpCloudWatchList"
        Effect = "Allow"
        Action = ["logs:DescribeLogGroups"]
        Resource = "*"
      },
      {
        Sid    = "GenUpIAM"
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
          "arn:aws:iam::*:role/genup-*",
          "arn:aws:iam::*:policy/genup-*"
        ]
      },
      {
        Sid    = "GenUpIAMList"
        Effect = "Allow"
        Action = [
          "iam:ListRoles",
          "iam:ListPolicies",
          "iam:GetAccountSummary"
        ]
        Resource = "*"
      },
      {
        Sid    = "GenUpKMS"
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
        Sid    = "GenUpKMSList"
        Effect = "Allow"
        Action = ["kms:ListKeys", "kms:ListAliases"]
        Resource = "*"
      },
      {
        Sid    = "GenUpSecretsManager"
        Effect = "Allow"
        Action = ["secretsmanager:*"]
        Resource = "arn:aws:secretsmanager:*:*:secret:genup-*"
      },
      {
        Sid    = "GenUpSecretsManagerList"
        Effect = "Allow"
        Action = ["secretsmanager:ListSecrets"]
        Resource = "*"
      },
      {
        Sid    = "GenUpSQS"
        Effect = "Allow"
        Action = ["sqs:*"]
        Resource = "arn:aws:sqs:*:*:genup-*"
      },
      {
        Sid    = "GenUpSQSList"
        Effect = "Allow"
        Action = ["sqs:ListQueues"]
        Resource = "*"
      },
      {
        Sid    = "GenUpBedrock"
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
        Sid    = "GenUpWAF"
        Effect = "Allow"
        Action = ["wafv2:*"]
        Resource = "*"
      },
      {
        Sid    = "GenUpSTS"
        Effect = "Allow"
        Action = [
          "sts:GetCallerIdentity",
          "sts:GetAccessKeyInfo"
        ]
        Resource = "*"
      },
      {
        Sid    = "GenUpTagging"
        Effect = "Allow"
        Action = [
          "tag:GetResources",
          "tag:TagResources",
          "tag:UntagResources"
        ]
        Resource = "*"
      },
      {
        Sid    = "GenUpXRay"
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

resource "aws_s3_bucket" "terraform_state" {
  bucket = "genup-terraform-state-${random_id.suffix.hex}"

  tags = {
    Name    = "GenUp Terraform State"
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
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "genup-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name    = "GenUp Terraform Locks"
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
  value       = aws_iam_user.genup_admin.name
}

output "user_arn" {
  description = "IAM user ARN"
  value       = aws_iam_user.genup_admin.arn
}

output "access_key_id" {
  description = "AWS Access Key ID"
  value       = aws_iam_access_key.genup_admin.id
}

output "secret_access_key" {
  description = "AWS Secret Access Key (sensitive)"
  value       = aws_iam_access_key.genup_admin.secret
  sensitive   = true
}

output "console_password" {
  description = "AWS Console Password (sensitive)"
  value       = aws_iam_user_login_profile.genup_admin.password
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

    aws configure --profile genup-admin
    # Enter Access Key ID: ${aws_iam_access_key.genup_admin.id}
    # Enter Secret Access Key: (run 'terraform output -raw secret_access_key')
    # Default region: ${var.aws_region}
    # Default output format: json

    Then use the profile:
    export AWS_PROFILE=genup-admin

    Or add to commands:
    aws s3 ls --profile genup-admin

    ================================================
    CONSOLE ACCESS
    ================================================

    Login URL: https://${data.aws_caller_identity.current.account_id}.signin.aws.amazon.com/console
    Username: ${aws_iam_user.genup_admin.name}
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
