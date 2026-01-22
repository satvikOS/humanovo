# GenUp IAM Admin User for Deployment and Testing
# This creates an IAM user with permissions to deploy and manage GenUp infrastructure

variable "create_admin_user" {
  description = "Whether to create the admin IAM user"
  type        = bool
  default     = true
}

variable "admin_user_name" {
  description = "Name for the admin IAM user"
  type        = string
  default     = "genup-admin"
}

# ==================== IAM User ====================

resource "aws_iam_user" "admin" {
  count = var.create_admin_user ? 1 : 0

  name = var.admin_user_name
  path = "/genup/"

  tags = {
    Name        = var.admin_user_name
    Purpose     = "GenUp deployment and testing"
    Environment = var.environment
  }
}

# ==================== Access Key ====================

resource "aws_iam_access_key" "admin" {
  count = var.create_admin_user ? 1 : 0

  user = aws_iam_user.admin[0].name
}

# ==================== IAM Policy ====================

resource "aws_iam_user_policy" "admin_policy" {
  count = var.create_admin_user ? 1 : 0

  name = "${var.admin_user_name}-policy"
  user = aws_iam_user.admin[0].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Terraform State Management
      {
        Sid    = "TerraformStateManagement"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketVersioning",
          "s3:GetBucketLocation"
        ]
        Resource = [
          "arn:aws:s3:::genup-*",
          "arn:aws:s3:::genup-*/*"
        ]
      },
      {
        Sid    = "DynamoDBStateLocking"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:CreateTable"
        ]
        Resource = "arn:aws:dynamodb:*:*:table/genup-terraform-*"
      },

      # IAM Management
      {
        Sid    = "IAMManagement"
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
          "iam:DeletePolicyVersion"
        ]
        Resource = [
          "arn:aws:iam::*:role/genup-*",
          "arn:aws:iam::*:policy/genup-*"
        ]
      },

      # Lambda
      {
        Sid    = "LambdaManagement"
        Effect = "Allow"
        Action = [
          "lambda:*"
        ]
        Resource = [
          "arn:aws:lambda:*:*:function:genup-*",
          "arn:aws:lambda:*:*:layer:genup-*",
          "arn:aws:lambda:*:*:layer:genup-*:*"
        ]
      },
      {
        Sid    = "LambdaEventSourceMapping"
        Effect = "Allow"
        Action = [
          "lambda:CreateEventSourceMapping",
          "lambda:DeleteEventSourceMapping",
          "lambda:GetEventSourceMapping",
          "lambda:ListEventSourceMappings",
          "lambda:UpdateEventSourceMapping"
        ]
        Resource = "*"
      },

      # API Gateway
      {
        Sid    = "APIGatewayManagement"
        Effect = "Allow"
        Action = [
          "apigateway:*"
        ]
        Resource = [
          "arn:aws:apigateway:*::/apis/*",
          "arn:aws:apigateway:*::/apis",
          "arn:aws:apigateway:*::/tags/*"
        ]
      },

      # S3
      {
        Sid    = "S3Management"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:GetBucketPolicy",
          "s3:PutBucketPolicy",
          "s3:DeleteBucketPolicy",
          "s3:GetBucketAcl",
          "s3:PutBucketAcl",
          "s3:GetBucketCORS",
          "s3:PutBucketCORS",
          "s3:GetBucketVersioning",
          "s3:PutBucketVersioning",
          "s3:GetBucketEncryption",
          "s3:PutBucketEncryption",
          "s3:GetBucketPublicAccessBlock",
          "s3:PutBucketPublicAccessBlock",
          "s3:GetBucketTagging",
          "s3:PutBucketTagging",
          "s3:GetLifecycleConfiguration",
          "s3:PutLifecycleConfiguration",
          "s3:GetBucketLogging",
          "s3:PutBucketLogging",
          "s3:ListBucket",
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "arn:aws:s3:::genup-*",
          "arn:aws:s3:::genup-*/*"
        ]
      },

      # DynamoDB
      {
        Sid    = "DynamoDBManagement"
        Effect = "Allow"
        Action = [
          "dynamodb:*"
        ]
        Resource = [
          "arn:aws:dynamodb:*:*:table/genup-*"
        ]
      },

      # CloudFront
      {
        Sid    = "CloudFrontManagement"
        Effect = "Allow"
        Action = [
          "cloudfront:*"
        ]
        Resource = "*"
      },

      # CloudWatch Logs
      {
        Sid    = "CloudWatchLogsManagement"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:DescribeLogGroups",
          "logs:PutRetentionPolicy",
          "logs:TagLogGroup",
          "logs:UntagLogGroup",
          "logs:ListTagsLogGroup",
          "logs:CreateLogStream",
          "logs:DeleteLogStream",
          "logs:DescribeLogStreams",
          "logs:GetLogEvents",
          "logs:PutLogEvents"
        ]
        Resource = [
          "arn:aws:logs:*:*:log-group:/aws/lambda/genup-*",
          "arn:aws:logs:*:*:log-group:/aws/lambda/genup-*:*",
          "arn:aws:logs:*:*:log-group:/aws/apigateway/genup-*",
          "arn:aws:logs:*:*:log-group:/aws/apigateway/genup-*:*",
          "arn:aws:logs:*:*:log-group:/aws/genup/*",
          "arn:aws:logs:*:*:log-group:/aws/genup/*:*"
        ]
      },

      # KMS
      {
        Sid    = "KMSManagement"
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
          "kms:ListAliases",
          "kms:ListKeys",
          "kms:TagResource",
          "kms:UntagResource",
          "kms:ListResourceTags",
          "kms:ScheduleKeyDeletion",
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
        Condition = {
          StringLike = {
            "kms:RequestAlias" = "alias/genup-*"
          }
        }
      },
      {
        Sid    = "KMSUseExisting"
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:GenerateDataKey",
          "kms:DescribeKey"
        ]
        Resource = "*"
      },

      # Secrets Manager
      {
        Sid    = "SecretsManagerManagement"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:TagResource",
          "secretsmanager:UntagResource",
          "secretsmanager:UpdateSecret"
        ]
        Resource = "arn:aws:secretsmanager:*:*:secret:genup-*"
      },

      # SQS
      {
        Sid    = "SQSManagement"
        Effect = "Allow"
        Action = [
          "sqs:*"
        ]
        Resource = "arn:aws:sqs:*:*:genup-*"
      },

      # Bedrock
      {
        Sid    = "BedrockAccess"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:ListFoundationModels",
          "bedrock:GetFoundationModel"
        ]
        Resource = "*"
      },

      # WAF
      {
        Sid    = "WAFManagement"
        Effect = "Allow"
        Action = [
          "wafv2:*"
        ]
        Resource = [
          "arn:aws:wafv2:*:*:global/webacl/genup-*",
          "arn:aws:wafv2:*:*:regional/webacl/genup-*"
        ]
      },
      {
        Sid    = "WAFCreate"
        Effect = "Allow"
        Action = [
          "wafv2:CreateWebACL",
          "wafv2:ListWebACLs"
        ]
        Resource = "*"
      },

      # STS for checking identity
      {
        Sid    = "STSAccess"
        Effect = "Allow"
        Action = [
          "sts:GetCallerIdentity"
        ]
        Resource = "*"
      },

      # Resource tagging
      {
        Sid    = "TaggingAccess"
        Effect = "Allow"
        Action = [
          "tag:GetResources",
          "tag:TagResources",
          "tag:UntagResources"
        ]
        Resource = "*"
      }
    ]
  })
}

# ==================== Console Access (Optional) ====================

resource "aws_iam_user_login_profile" "admin" {
  count = var.create_admin_user ? 1 : 0

  user                    = aws_iam_user.admin[0].name
  password_reset_required = true
}

# ==================== Outputs ====================

output "admin_user_name" {
  description = "IAM admin user name"
  value       = var.create_admin_user ? aws_iam_user.admin[0].name : null
}

output "admin_user_arn" {
  description = "IAM admin user ARN"
  value       = var.create_admin_user ? aws_iam_user.admin[0].arn : null
}

output "admin_access_key_id" {
  description = "Access key ID for the admin user"
  value       = var.create_admin_user ? aws_iam_access_key.admin[0].id : null
  sensitive   = true
}

output "admin_secret_access_key" {
  description = "Secret access key for the admin user"
  value       = var.create_admin_user ? aws_iam_access_key.admin[0].secret : null
  sensitive   = true
}

output "admin_console_password" {
  description = "Initial console password for the admin user"
  value       = var.create_admin_user ? aws_iam_user_login_profile.admin[0].password : null
  sensitive   = true
}
