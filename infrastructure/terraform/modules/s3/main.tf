# GenUp S3 Module - Unified Bucket Configuration
# Single bucket with prefix-based organization for simplicity and cost efficiency

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
  type = string
}

# ==================== Single Unified Bucket ====================
# Structure:
#   /frontend/     - Static website assets (React build)
#   /data/         - Data lake (raw/processed ingestion data)
#   /artifacts/    - Lambda code, layers, build artifacts
#   /uploads/      - User uploads
#   /exports/      - Generated reports/exports

resource "aws_s3_bucket" "main" {
  bucket        = "genup-${var.environment}"
  force_destroy = var.environment != "prod"

  tags = {
    Name        = "genup-${var.environment}"
    Purpose     = "Unified storage for GenUp platform"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = var.kms_key_arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
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

resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  # Data prefix - transition to cheaper storage over time
  rule {
    id     = "data-lifecycle"
    status = "Enabled"

    filter {
      prefix = "data/"
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 180
      storage_class = "GLACIER"
    }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }

    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }

  # Exports - expire after 30 days
  rule {
    id     = "exports-cleanup"
    status = "Enabled"

    filter {
      prefix = "exports/"
    }

    expiration {
      days = 30
    }
  }

  # Uploads - transition to IA after 30 days
  rule {
    id     = "uploads-lifecycle"
    status = "Enabled"

    filter {
      prefix = "uploads/"
    }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
  }
}

# ==================== Outputs ====================
# Maintain backward compatibility with existing module references

output "bucket_id" {
  description = "Main bucket ID"
  value       = aws_s3_bucket.main.id
}

output "bucket_arn" {
  description = "Main bucket ARN"
  value       = aws_s3_bucket.main.arn
}

output "bucket_name" {
  description = "Main bucket name"
  value       = aws_s3_bucket.main.bucket
}

output "bucket_regional_domain" {
  description = "Main bucket regional domain name"
  value       = aws_s3_bucket.main.bucket_regional_domain_name
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
