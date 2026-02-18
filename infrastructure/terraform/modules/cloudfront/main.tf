# GenUp CloudFront Module - Simplified Configuration
# Direct S3 origin, no path complexity, proper OAC setup

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "name_prefix" {
  type = string
}

variable "suffix" {
  type = string
}

variable "environment" {
  type = string
}

variable "frontend_bucket_id" {
  type = string
}

variable "frontend_bucket_arn" {
  type = string
}

variable "frontend_bucket_domain" {
  type = string
}

variable "api_gateway_endpoint" {
  type = string
}

variable "api_gateway_id" {
  type = string
}

variable "domain_name" {
  type    = string
  default = ""
}

variable "certificate_arn" {
  type    = string
  default = ""
}

variable "waf_enabled" {
  type    = bool
  default = false
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

locals {
  s3_origin_id      = "S3-${var.frontend_bucket_id}"
  api_origin_id     = "API-Gateway"
  use_custom_domain = var.domain_name != "" && var.certificate_arn != ""
}

# ==================== Origin Access Control ====================

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.name_prefix}-oac-${var.suffix}"
  description                       = "OAC for GenUp frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ==================== S3 Bucket Policy for CloudFront ====================
# CRITICAL: This policy allows CloudFront OAC to access the bucket
# The condition uses the distribution ARN to restrict access

data "aws_iam_policy_document" "frontend_bucket_policy" {
  statement {
    sid    = "AllowCloudFrontOAC"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${var.frontend_bucket_arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = var.frontend_bucket_id
  policy = data.aws_iam_policy_document.frontend_bucket_policy.json
}

# ==================== CloudFront Distribution ====================

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "GenUp ${var.environment}"
  default_root_object = "index.html"
  price_class         = var.price_class
  web_acl_id          = var.waf_enabled ? aws_wafv2_web_acl.main[0].arn : null

  aliases = local.use_custom_domain ? [var.domain_name] : []

  # S3 Origin - Direct, no origin_path
  origin {
    domain_name              = var.frontend_bucket_domain
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # API Gateway Origin
  # origin_path adds the stage name so CloudFront requests are properly routed:
  # /api/v1/projects → API Gateway receives /{stage}/api/v1/projects
  origin {
    domain_name = replace(replace(var.api_gateway_endpoint, "https://", ""), "/", "")
    origin_id   = local.api_origin_id
    origin_path = "/${var.environment}"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default behavior - serve from S3
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = local.s3_origin_id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_routing.arn
    }
  }

  # API behavior - /api/* goes to API Gateway
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = local.api_origin_id

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type"]
      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "https-only"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
    compress               = true
  }

  # SPA routing - return index.html for 403/404
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  # Never cache 5xx errors from API Gateway — pass through immediately
  custom_error_response {
    error_code            = 500
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 502
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 503
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 504
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.use_custom_domain
    acm_certificate_arn            = local.use_custom_domain ? var.certificate_arn : null
    ssl_support_method             = local.use_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_domain ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = {
    Name = "${var.name_prefix}-cdn"
  }
}

# ==================== WAF (Optional) ====================

resource "aws_wafv2_web_acl" "main" {
  count = var.waf_enabled ? 1 : 0

  name        = "${var.name_prefix}-waf-${var.suffix}"
  description = "WAF for GenUp"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "RateLimit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 10000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-waf"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "${var.name_prefix}-waf"
  }
}

# ==================== CloudFront Function for SPA ====================

resource "aws_cloudfront_function" "spa_routing" {
  name    = "${var.name_prefix}-spa-routing-${var.suffix}"
  runtime = "cloudfront-js-2.0"
  comment = "SPA routing for React app"
  publish = true
  code    = <<-EOF
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      // If URI has extension, serve as-is
      if (uri.includes('.')) {
        return request;
      }

      // API requests pass through
      if (uri.startsWith('/api/') || uri === '/health') {
        return request;
      }

      // All other requests serve index.html
      request.uri = '/index.html';
      return request;
    }
  EOF
}

# ==================== Outputs ====================

output "distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.main.arn
}

output "domain_name" {
  value = aws_cloudfront_distribution.main.domain_name
}

output "hosted_zone_id" {
  value = aws_cloudfront_distribution.main.hosted_zone_id
}

output "oac_id" {
  value = aws_cloudfront_origin_access_control.frontend.id
}
