# humanovo Frontend Bootstrap — fresh new-account stack
#
# Provisions a minimal frontend hosting stack in the *new* AWS business
# account, separate from the legacy `genup-*` infrastructure:
#
#   - one private S3 bucket for the Vite build output (encryption at rest,
#     versioning ON, public-access fully blocked),
#   - one CloudFront distribution with Origin Access Control reading from
#     that bucket,
#   - SPA-correct error responses (404 / 403 → /index.html so React Router
#     deep links work),
#   - Compress + gzip-aware caching.
#
# Output: `cloudfront_domain` — the *.cloudfront.net hostname the founder
# can paste into a browser to reach the freshly-deployed frontend.
#
# State lives in S3 in the new account: `humanovo-tf-state-<region>`. The
# workflow `bootstrap-frontend-cloudfront.yml` creates that bucket on the
# first run if it doesn't exist (idempotent).

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # All values come from `terraform init -backend-config=...` in the
  # workflow so we don't hardcode account-specific bucket names here.
  backend "s3" {}
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "name_prefix" {
  type    = string
  default = "humanovo"
}

variable "environment" {
  type    = string
  default = "prod"
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "humanovo"
      Environment = var.environment
      ManagedBy   = "terraform"
      Stack       = "frontend-bootstrap"
    }
  }
}

locals {
  bucket_name = "${var.name_prefix}-${var.environment}-frontend"
}

# ─── S3: private origin bucket ──────────────────────────────────────

resource "aws_s3_bucket" "frontend" {
  bucket        = local.bucket_name
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  versioning_configuration {
    status = "Enabled"
  }
}

# ─── CloudFront: distribution + Origin Access Control ───────────────

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.bucket_name}-oac"
  description                       = "OAC for ${local.bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.name_prefix}-${var.environment}-frontend"
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-${local.bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-${local.bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # Use the AWS-managed CachingOptimized policy so we don't have to
    # roll our own ttls / cookie / header forwarding rules. ID is
    # stable across regions (managed by AWS).
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
 claude/production-platform-analysis-30H5c

    # Admin gate — rejects viewer requests without X-Admin-Secret.
    # See admin-lockdown.tf. End users use the native desktop app;
    # this CloudFront URL is the founder's testing surface.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.admin_gate.arn
    }

 humanovo
  }

  # SPA fallback — React Router deep links 404 against S3 because
  # the file `/dashboard` doesn't exist; rewrite to /index.html so
  # the client-side router takes over.
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 60
  }
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  price_class = "PriceClass_100" # NA + EU only — keeps cost down at the closed-beta scale
}

# Bucket policy granting the CloudFront distribution read access via OAC.
data "aws_iam_policy_document" "frontend_bucket" {
  statement {
    sid    = "AllowCloudFrontServicePrincipalRead"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.frontend.arn}/*",
    ]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json
}

# ─── Outputs ────────────────────────────────────────────────────────

output "cloudfront_domain" {
  description = "Public CloudFront hostname (paste into browser to reach the deployed frontend)"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — needed for cache invalidations on deploy"
  value       = aws_cloudfront_distribution.frontend.id
}

output "frontend_bucket" {
  description = "S3 bucket name where the Vite build artifacts are uploaded"
  value       = aws_s3_bucket.frontend.id
}
