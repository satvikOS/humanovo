# humanovo Production Environment Configuration

environment = "prod"
aws_region  = "us-east-1"
owner       = "humanovo-team"

# Domain (configure with your domain)
domain_name         = ""  # e.g., "humanovo.example.com"
acm_certificate_arn = ""  # e.g., "arn:aws:acm:us-east-1:123456789:certificate/xxx"

# Lambda Configuration (higher limits for production)
lambda_memory_size = 2048
lambda_timeout     = 60

# Bedrock Models
bedrock_model_id           = "us.anthropic.claude-opus-4-6-v1"
bedrock_embedding_model_id = "amazon.titan-embed-text-v2:0"

# API Gateway
cors_allowed_origins = ["https://humanovo.example.com"]  # Restrict in production
enable_jwt_auth      = true
jwt_issuer           = ""  # e.g., "https://auth.example.com"
jwt_audience         = []  # e.g., ["humanovo-api"]

# CloudFront
cloudfront_price_class = "PriceClass_200"  # Include more edge locations
waf_enabled            = true

# DynamoDB
dynamodb_billing_mode = "PAY_PER_REQUEST"

# Logging
log_retention_days  = 90
enable_xray_tracing = true

# OpenSearch (enabled for production vector search)
enable_opensearch          = true
opensearch_collection_name = "humanovo-vectors"

# API Keys (set via environment variables or secrets)
# openai_api_key  = ""
# google_api_key  = ""
# brave_api_key   = ""
# pubmed_api_key  = ""
