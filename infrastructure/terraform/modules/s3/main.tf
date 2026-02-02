# GenUp S3 Module - Simplified Single Bucket
# No prefixes, no complexity - just works

variable "name_prefix" {
  type = string
}

variable "suffix" {
  type = string
}

variable "environment" {
  type = string
}

variable "kms_key_arn" {
  type    = string
  default = ""
}

# ==================== Single Frontend Bucket ====================

resource "aws_s3_bucket" "main" {
  bucket        = "genup-${var.environment}-${var.suffix}"
  force_destroy = var.environment != "prod"

  tags = {
    Name        = "genup-${var.environment}-${var.suffix}"
    Purpose     = "GenUp frontend and assets"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 encryption - works with CloudFront OAC without KMS complexity
resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket = aws_s3_bucket.main.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# ==================== Outputs ====================

output "bucket_id" {
  value = aws_s3_bucket.main.id
}

output "bucket_arn" {
  value = aws_s3_bucket.main.arn
}

output "bucket_name" {
  value = aws_s3_bucket.main.bucket
}

output "bucket_regional_domain" {
  value = aws_s3_bucket.main.bucket_regional_domain_name
}

# Legacy outputs for backward compatibility
output "frontend_bucket_id" {
  value = aws_s3_bucket.main.id
}

output "frontend_bucket_arn" {
  value = aws_s3_bucket.main.arn
}

output "frontend_bucket_name" {
  value = aws_s3_bucket.main.bucket
}

output "frontend_bucket_regional_domain" {
  value = aws_s3_bucket.main.bucket_regional_domain_name
}

output "data_bucket_id" {
  value = aws_s3_bucket.main.id
}

output "data_bucket_arn" {
  value = aws_s3_bucket.main.arn
}

output "data_bucket_name" {
  value = aws_s3_bucket.main.bucket
}

output "artifacts_bucket_id" {
  value = aws_s3_bucket.main.id
}

output "artifacts_bucket_arn" {
  value = aws_s3_bucket.main.arn
}

output "artifacts_bucket_name" {
  value = aws_s3_bucket.main.bucket
}
