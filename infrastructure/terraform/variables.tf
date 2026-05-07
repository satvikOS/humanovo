# humanovo AWS Infrastructure - Variables

# ==================== General ====================

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "owner" {
  description = "Owner tag for resources"
  type        = string
  default     = "humanovo-team"
}

# ==================== Domain & SSL ====================

variable "domain_name" {
  description = "Custom domain name for CloudFront (optional)"
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ARN of ACM certificate for custom domain (must be in us-east-1)"
  type        = string
  default     = ""
}

# ==================== API Keys & Secrets ====================

variable "openai_api_key" {
  description = "OpenAI API key (for fallback if Bedrock unavailable)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_api_key" {
  description = "Google Custom Search API key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "brave_api_key" {
  description = "Brave Search API key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "pubmed_api_key" {
  description = "NCBI PubMed API key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT signing secret (auto-generated if empty)"
  type        = string
  default     = ""
  sensitive   = true
}

# ==================== Lambda Configuration ====================

variable "lambda_memory_size" {
  description = "Memory size for Lambda functions (MB)"
  type        = number
  default     = 1024

  validation {
    condition     = var.lambda_memory_size >= 128 && var.lambda_memory_size <= 10240
    error_message = "Lambda memory must be between 128 and 10240 MB."
  }
}

variable "lambda_timeout" {
  description = "Timeout for Lambda functions (seconds)"
  type        = number
  default     = 30

  validation {
    condition     = var.lambda_timeout >= 1 && var.lambda_timeout <= 900
    error_message = "Lambda timeout must be between 1 and 900 seconds."
  }
}

variable "lambda_reserved_concurrency" {
  description = "Reserved concurrent executions for Lambda (-1 for no limit)"
  type        = number
  default     = -1
}

# ==================== Bedrock Configuration ====================

variable "bedrock_model_id" {
  description = "Bedrock model ID for Explorer + Synthesizer (Claude Opus 4.6)"
  type        = string
  default     = "us.anthropic.claude-opus-4-6-v1:0"
}

variable "bedrock_embedding_model_id" {
  description = "Bedrock model ID for embeddings"
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

# ==================== Azure AI — Shared Endpoint ====================

variable "azure_ai_endpoint" {
  description = "Azure AI shared endpoint (Mistral at same resource)"
  type        = string
  default     = ""
}

variable "azure_ai_key" {
  description = "Azure AI shared API key"
  type        = string
  default     = ""
  sensitive   = true
}

# ==================== Azure AI — Per-Model Overrides ====================

variable "azure_mistral_endpoint" {
  description = "Azure AI Mistral-Large-3 model-specific endpoint"
  type        = string
  default     = ""
}

variable "azure_mistral_key" {
  description = "Azure AI Mistral-Large-3 API key"
  type        = string
  default     = ""
  sensitive   = true
}

# ==================== Azure OpenAI — Per-Model Endpoints ====================

variable "azure_gpt4o_endpoint" {
  description = "Azure OpenAI GPT-4o deployment endpoint"
  type        = string
  default     = ""
}

variable "azure_gpt4o_key" {
  description = "Azure OpenAI GPT-4o API key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "azure_cohere_endpoint" {
  description = "Azure AI Cohere Command A endpoint"
  type        = string
  default     = ""
}

variable "azure_cohere_key" {
  description = "Azure AI Cohere Command A API key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "azure_o3mini_endpoint" {
  description = "Azure OpenAI o3-mini endpoint"
  type        = string
  default     = ""
}

variable "azure_o3mini_key" {
  description = "Azure OpenAI o3-mini API key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "azure_gpt41_endpoint" {
  description = "Azure OpenAI GPT-4.1 endpoint"
  type        = string
  default     = ""
}

variable "azure_gpt41_key" {
  description = "Azure OpenAI GPT-4.1 API key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "azure_phi4_endpoint" {
  description = "Azure AI Phi-4 Reasoning endpoint"
  type        = string
  default     = ""
}

variable "azure_phi4_key" {
  description = "Azure AI Phi-4 Reasoning API key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "azure_grok_endpoint" {
  description = "Azure AI Grok-4.1 Fast Reasoning endpoint"
  type        = string
  default     = ""
}

variable "azure_grok_key" {
  description = "Azure AI Grok-4.1 Fast Reasoning API key"
  type        = string
  default     = ""
  sensitive   = true
}

# ==================== Azure OpenAI — Embedding Models ====================

variable "azure_embedding_endpoint" {
  description = "Azure OpenAI endpoint for embedding models (text-embedding-3-large + text-embedding-3-small)"
  type        = string
  default     = ""
}

variable "azure_embedding_key" {
  description = "Azure OpenAI API key for embedding models"
  type        = string
  default     = ""
  sensitive   = true
}

# ==================== API Gateway ====================

variable "cors_allowed_origins" {
  description = "Allowed origins for CORS"
  type        = list(string)
  default     = ["*"]
}

variable "enable_jwt_auth" {
  description = "Enable JWT authorization on API Gateway"
  type        = bool
  default     = false
}

variable "jwt_issuer" {
  description = "JWT token issuer URL"
  type        = string
  default     = ""
}

variable "jwt_audience" {
  description = "JWT token audience"
  type        = list(string)
  default     = []
}

variable "api_throttling_rate_limit" {
  description = "API Gateway throttling rate limit (requests/second)"
  type        = number
  default     = 1000
}

variable "api_throttling_burst_limit" {
  description = "API Gateway throttling burst limit"
  type        = number
  default     = 2000
}

# ==================== CloudFront ====================

variable "cloudfront_price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "Invalid CloudFront price class."
  }
}

variable "waf_enabled" {
  description = "Enable AWS WAF on CloudFront (disabled by default to avoid orphaned resources)"
  type        = bool
  default     = false
}

# ==================== DynamoDB ====================

variable "dynamodb_billing_mode" {
  description = "DynamoDB billing mode (PROVISIONED or PAY_PER_REQUEST)"
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "dynamodb_read_capacity" {
  description = "DynamoDB read capacity units (if PROVISIONED)"
  type        = number
  default     = 5
}

variable "dynamodb_write_capacity" {
  description = "DynamoDB write capacity units (if PROVISIONED)"
  type        = number
  default     = 5
}

# ==================== Logging & Monitoring ====================

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "enable_xray_tracing" {
  description = "Enable AWS X-Ray tracing"
  type        = bool
  default     = true
}

# ==================== OpenSearch (Vector DB) ====================

variable "enable_opensearch" {
  description = "Enable OpenSearch Serverless for vector search"
  type        = bool
  default     = false
}

variable "opensearch_collection_name" {
  description = "OpenSearch Serverless collection name"
  type        = string
  default     = "humanovo-vectors"
}
