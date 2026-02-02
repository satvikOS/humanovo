# GenUp CloudFront Module - CDN Configuration

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
  type        = string
  description = "Random suffix for unique resource names"
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
  default = true
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

locals {
  s3_origin_id  = "S3-${var.frontend_bucket_id}"
  api_origin_id = "API-Gateway"
  use_custom_domain = var.domain_name != "" && var.certificate_arn != ""
}

# ==================== Origin Access Control ====================

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.name_prefix}-frontend-oac-${var.suffix}"
  description                       = "OAC for GenUp frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ==================== S3 Bucket Policy for CloudFront ====================

data "aws_iam_policy_document" "frontend_bucket_policy" {
  statement {
    sid    = "AllowCloudFrontServicePrincipal"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    # Allow access to frontend/ prefix in unified bucket
    resources = ["${var.frontend_bucket_arn}/frontend/*"]

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

# ==================== WAF Web ACL (optional) ====================

resource "aws_wafv2_web_acl" "main" {
  count = var.waf_enabled ? 1 : 0

  name        = "${var.name_prefix}-waf-${var.suffix}"
  description = "WAF for GenUp CloudFront distribution"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # AWS Managed Rules - Common Rule Set
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - Known Bad Inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # Rate Limiting Rule
  rule {
    name     = "RateLimitRule"
    priority = 3

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

# ==================== CloudFront Distribution ====================

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "GenUp ${var.environment} distribution"
  default_root_object = "index.html"
  price_class         = var.price_class
  web_acl_id          = var.waf_enabled ? aws_wafv2_web_acl.main[0].arn : null

  aliases = local.use_custom_domain ? [var.domain_name] : []

  # S3 Origin for Frontend (using frontend/ prefix in unified bucket)
  origin {
    domain_name              = var.frontend_bucket_domain
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
    origin_path              = "/frontend"
  }

  # API Gateway Origin
  origin {
    domain_name = replace(var.api_gateway_endpoint, "https://", "")
    origin_id   = local.api_origin_id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default behavior - S3 frontend
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
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_routing.arn
    }
  }

  # API behavior - pass through to API Gateway
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = local.api_origin_id

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type", "X-Request-ID"]

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

  # Health check endpoint - no auth, cacheable
  ordered_cache_behavior {
    path_pattern     = "/health"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = local.api_origin_id

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "https-only"
    min_ttl                = 0
    default_ttl            = 60
    max_ttl                = 300
    compress               = true
  }

  # Static assets - long cache
  ordered_cache_behavior {
    path_pattern     = "/assets/*"
    allowed_methods  = ["GET", "HEAD"]
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
  }

  # Custom error responses for SPA
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
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

  # Logging disabled - would require S3 bucket ACL which is a security concern
  # Enable logging by creating a dedicated log bucket with ACLs enabled
  # logging_config {
  #   include_cookies = false
  #   bucket          = "${var.frontend_bucket_id}.s3.amazonaws.com"
  #   prefix          = "cloudfront-logs/"
  # }

  tags = {
    Name = "${var.name_prefix}-distribution"
  }
}

# ==================== CloudFront Function for SPA Routing ====================

resource "aws_cloudfront_function" "spa_routing" {
  name    = "${var.name_prefix}-spa-routing-${var.suffix}"
  runtime = "cloudfront-js-2.0"
  comment = "Handles SPA routing for React app"
  publish = true
  code    = <<-EOF
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      // Check if the URI has a file extension
      if (uri.includes('.')) {
        return request;
      }

      // Check if it's an API request
      if (uri.startsWith('/api/') || uri === '/health') {
        return request;
      }

      // For all other requests, serve index.html
      request.uri = '/index.html';
      return request;
    }
  EOF
}

# ==================== Outputs ====================

output "distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.main.id
}

output "distribution_arn" {
  description = "CloudFront distribution ARN"
  value       = aws_cloudfront_distribution.main.arn
}

output "domain_name" {
  description = "CloudFront domain name"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "hosted_zone_id" {
  description = "CloudFront hosted zone ID"
  value       = aws_cloudfront_distribution.main.hosted_zone_id
}

output "oac_id" {
  description = "Origin Access Control ID"
  value       = aws_cloudfront_origin_access_control.frontend.id
}
