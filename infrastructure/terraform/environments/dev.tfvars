# GenUp Development Environment Configuration

environment = "dev"
aws_region  = "us-east-1"
owner       = "genup-team"

# Domain (leave empty for CloudFront default domain)
domain_name         = ""
acm_certificate_arn = ""

# Lambda Configuration
lambda_memory_size = 1024
lambda_timeout     = 30

# Bedrock Models
bedrock_model_id           = "anthropic.claude-3-5-sonnet-20241022-v2:0"
bedrock_embedding_model_id = "amazon.titan-embed-text-v2:0"

# API Gateway
cors_allowed_origins = ["*"]
enable_jwt_auth      = false
jwt_issuer           = ""
jwt_audience         = []

# CloudFront
cloudfront_price_class = "PriceClass_100"
waf_enabled            = true

# DynamoDB
dynamodb_billing_mode = "PAY_PER_REQUEST"

# Logging
log_retention_days = 14
enable_xray_tracing = true

# OpenSearch (disabled for dev to save costs)
enable_opensearch = false

# API Keys (set via environment variables or terraform.tfvars.local)
# openai_api_key  = ""
# google_api_key  = ""
# brave_api_key   = ""
# pubmed_api_key  = ""
