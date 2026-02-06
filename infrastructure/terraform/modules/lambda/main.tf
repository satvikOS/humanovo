# GenUp Lambda Module - Function Configuration

variable "name_prefix" {
  type = string
}

variable "suffix" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "account_id" {
  type        = string
  description = "AWS Account ID"
}

variable "kms_key_arn" {
  type = string
}

variable "secrets_arn" {
  type = string
}

variable "lambda_role_arn" {
  type = string
}

variable "log_group_name" {
  type = string
}

variable "projects_table_name" {
  type = string
}

variable "hypotheses_table_name" {
  type = string
}

variable "evidence_table_name" {
  type = string
}

variable "simulations_table_name" {
  type = string
}

variable "data_bucket_name" {
  type = string
}

variable "artifacts_bucket_name" {
  type = string
}

variable "bedrock_model_id" {
  type = string
}

variable "bedrock_embedding_model_id" {
  type = string
}

variable "lambda_memory_size" {
  type    = number
  default = 1024
}

variable "lambda_timeout" {
  type    = number
  default = 30
}

locals {
  common_env_vars = {
    ENVIRONMENT                = var.environment
    AWS_REGION_NAME            = var.aws_region
    SECRETS_ARN                = var.secrets_arn
    PROJECTS_TABLE             = var.projects_table_name
    HYPOTHESES_TABLE           = var.hypotheses_table_name
    EVIDENCE_TABLE             = var.evidence_table_name
    SIMULATIONS_TABLE          = var.simulations_table_name
    # Unified bucket with prefix-based organization
    GENUP_BUCKET               = var.data_bucket_name
    DATA_PREFIX                = "data"
    ARTIFACTS_PREFIX           = "artifacts"
    UPLOADS_PREFIX             = "uploads"
    EXPORTS_PREFIX             = "exports"
    BEDROCK_MODEL_ID           = var.bedrock_model_id
    BEDROCK_EMBEDDING_MODEL_ID = var.bedrock_embedding_model_id
    LOG_LEVEL                  = var.environment == "prod" ? "INFO" : "DEBUG"
    POWERTOOLS_SERVICE_NAME    = "genup"
    POWERTOOLS_METRICS_NAMESPACE = "GenUp"
  }

  lambda_functions = {
    # Core API Functions
    api_core = {
      description = "Core API handler (health, auth)"
      handler     = "handlers.api_core.handler"
      memory      = 512
      timeout     = 10
    }

    projects = {
      description = "Projects CRUD operations"
      handler     = "handlers.projects.handler"
      memory      = 512
      timeout     = 15
    }

    hypotheses = {
      description = "Hypotheses management"
      handler     = "handlers.hypotheses.handler"
      memory      = 1024
      timeout     = 30
    }

    evidence = {
      description = "Evidence search and management"
      handler     = "handlers.evidence.handler"
      memory      = 1024
      timeout     = 30
    }

    knowledge = {
      description = "Knowledge graph operations"
      handler     = "handlers.knowledge.handler"
      memory      = 1024
      timeout     = 30
    }

    # AI/ML Functions
    hypothesis_generation = {
      description = "AI hypothesis generation with Bedrock"
      handler     = "handlers.hypothesis_generation.handler"
      memory      = 2048
      timeout     = 120
    }

    agent_orchestrator = {
      description = "Multi-agent orchestration"
      handler     = "handlers.agent_orchestrator.handler"
      memory      = 2048
      timeout     = 300
    }

    search_agent = {
      description = "Search agent for external sources"
      handler     = "handlers.search_agent.handler"
      memory      = 1024
      timeout     = 60
    }

    embeddings = {
      description = "Vector embeddings generation"
      handler     = "handlers.embeddings.handler"
      memory      = 1024
      timeout     = 60
    }

    # Simulation Functions
    simulation = {
      description = "Monte Carlo simulation execution"
      handler     = "handlers.simulation.handler"
      memory      = 3008
      timeout     = 300
    }

    simulation_worker = {
      description = "Simulation batch worker"
      handler     = "handlers.simulation_worker.handler"
      memory      = 3008
      timeout     = 900
    }

    # Ingestion Functions
    ingestion = {
      description = "Data ingestion orchestration"
      handler     = "handlers.ingestion.handler"
      memory      = 2048
      timeout     = 300
    }

    pubmed_fetcher = {
      description = "PubMed data fetcher"
      handler     = "handlers.pubmed_fetcher.handler"
      memory      = 1024
      timeout     = 120
    }

    clinical_trials_fetcher = {
      description = "ClinicalTrials.gov fetcher"
      handler     = "handlers.clinical_trials_fetcher.handler"
      memory      = 1024
      timeout     = 120
    }

    # New continuous ingestion functions
    brave_search_fetcher = {
      description = "Brave Search API fetcher with rate limiting"
      handler     = "handlers.brave_search_fetcher.handler"
      memory      = 512
      timeout     = 60
    }

    embeddings_generator = {
      description = "Vector embeddings generation pipeline"
      handler     = "handlers.embeddings_generator.handler"
      memory      = 1024
      timeout     = 120
    }

    rag_retrieval = {
      description = "RAG retrieval with caching"
      handler     = "handlers.rag_retrieval.handler"
      memory      = 1024
      timeout     = 30
    }

    ingestion_scheduler = {
      description = "Scheduled ingestion orchestrator"
      handler     = "handlers.ingestion_scheduler.handler"
      memory      = 512
      timeout     = 300
    }
  }
}

# ==================== Lambda Layer ====================

resource "aws_lambda_layer_version" "dependencies" {
  layer_name          = "${var.name_prefix}-dependencies"
  description         = "GenUp Python dependencies"
  compatible_runtimes = ["python3.11"]
  s3_bucket           = var.artifacts_bucket_name
  s3_key              = "artifacts/lambda-layers/dependencies.zip"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lambda_layer_version" "scipy" {
  layer_name          = "${var.name_prefix}-scipy"
  description         = "NumPy and SciPy for simulations"
  compatible_runtimes = ["python3.11"]
  s3_bucket           = var.artifacts_bucket_name
  s3_key              = "artifacts/lambda-layers/scipy.zip"

  lifecycle {
    create_before_destroy = true
  }
}

# ==================== Lambda Functions ====================

resource "aws_lambda_function" "functions" {
  for_each = local.lambda_functions

  function_name = "${var.name_prefix}-${each.key}"
  description   = each.value.description
  role          = var.lambda_role_arn
  handler       = each.value.handler
  runtime       = "python3.11"
  timeout       = each.value.timeout
  memory_size   = each.value.memory

  s3_bucket = var.artifacts_bucket_name
  s3_key    = "artifacts/lambda-functions/${each.key}.zip"

  layers = each.key == "simulation" || each.key == "simulation_worker" ? [
    aws_lambda_layer_version.dependencies.arn,
    aws_lambda_layer_version.scipy.arn,
  ] : [
    aws_lambda_layer_version.dependencies.arn,
  ]

  environment {
    variables = local.common_env_vars
  }

  tracing_config {
    mode = "Active"
  }

  kms_key_arn = var.kms_key_arn

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${var.name_prefix}-${each.key}"
  }

  tags = {
    Name     = "${var.name_prefix}-${each.key}"
    Function = each.key
  }

  lifecycle {
    ignore_changes = [
      s3_key,
      source_code_hash,
      last_modified,
    ]
  }
}

# ==================== CloudWatch Log Groups ====================

resource "aws_cloudwatch_log_group" "lambda_logs" {
  for_each = local.lambda_functions

  name              = "/aws/lambda/${var.name_prefix}-${each.key}"
  retention_in_days = var.environment == "prod" ? 90 : 14
  # Using default encryption to avoid KMS permission complexity
  # kms_key_id        = var.kms_key_arn

  tags = {
    Name     = "${var.name_prefix}-${each.key}-logs"
    Function = each.key
  }
}

# ==================== Lambda Permissions for API Gateway ====================

resource "aws_lambda_permission" "api_gateway" {
  for_each = {
    for k, v in local.lambda_functions : k => v
    if !contains(["simulation_worker", "ingestion", "pubmed_fetcher", "clinical_trials_fetcher"], k)
  }

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.functions[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "arn:aws:execute-api:${var.aws_region}:${var.account_id}:*/*/*"
}

# ==================== SQS Queue for Async Processing ====================

resource "aws_sqs_queue" "simulation_queue" {
  name                       = "${var.name_prefix}-simulation-queue"
  visibility_timeout_seconds = 910
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 10

  kms_master_key_id = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.simulation_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "${var.name_prefix}-simulation-queue"
  }
}

resource "aws_sqs_queue" "simulation_dlq" {
  name = "${var.name_prefix}-simulation-dlq"

  kms_master_key_id = var.kms_key_arn

  tags = {
    Name = "${var.name_prefix}-simulation-dlq"
  }
}

resource "aws_lambda_event_source_mapping" "simulation_queue" {
  event_source_arn = aws_sqs_queue.simulation_queue.arn
  function_name    = aws_lambda_function.functions["simulation_worker"].arn
  batch_size       = 1
}

# ==================== Embeddings Queue ====================

resource "aws_sqs_queue" "embeddings_queue" {
  name                       = "${var.name_prefix}-embeddings-queue"
  visibility_timeout_seconds = 130  # Slightly higher than Lambda timeout
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 10

  kms_master_key_id = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.embeddings_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "${var.name_prefix}-embeddings-queue"
  }
}

resource "aws_sqs_queue" "embeddings_dlq" {
  name = "${var.name_prefix}-embeddings-dlq"

  kms_master_key_id = var.kms_key_arn

  tags = {
    Name = "${var.name_prefix}-embeddings-dlq"
  }
}

resource "aws_lambda_event_source_mapping" "embeddings_queue" {
  event_source_arn = aws_sqs_queue.embeddings_queue.arn
  function_name    = aws_lambda_function.functions["embeddings_generator"].arn
  batch_size       = 10  # Process multiple embeddings per invocation
}

# ==================== EventBridge Scheduled Ingestion ====================
# NOTE: EventBridge rules temporarily disabled due to IAM permission issue
# (events:TagResource not allowed). Enable when IAM permissions are updated.
# For now, ingestion can be triggered manually via Lambda console or API.

# TODO: Re-enable when IAM user has events:TagResource permission
# Full ingestion every 4 hours
# resource "aws_cloudwatch_event_rule" "full_ingestion" {
#   name                = "${var.name_prefix}-full-ingestion"
#   description         = "Trigger full knowledge base ingestion every 4 hours"
#   schedule_expression = "rate(4 hours)"
# }
#
# resource "aws_cloudwatch_event_target" "full_ingestion" {
#   rule      = aws_cloudwatch_event_rule.full_ingestion.name
#   target_id = "IngestionScheduler"
#   arn       = aws_lambda_function.functions["ingestion_scheduler"].arn
#   input = jsonencode({ schedule_type = "full" })
# }
#
# resource "aws_lambda_permission" "eventbridge_full_ingestion" {
#   statement_id  = "AllowEventBridgeFullIngestion"
#   action        = "lambda:InvokeFunction"
#   function_name = aws_lambda_function.functions["ingestion_scheduler"].function_name
#   principal     = "events.amazonaws.com"
#   source_arn    = aws_cloudwatch_event_rule.full_ingestion.arn
# }

# ==================== Outputs ====================

output "function_arns" {
  description = "Map of function names to ARNs"
  value       = { for k, v in aws_lambda_function.functions : k => v.arn }
}

output "function_names" {
  description = "Map of function keys to names"
  value       = { for k, v in aws_lambda_function.functions : k => v.function_name }
}

output "invoke_arns" {
  description = "Map of function names to invoke ARNs"
  value       = { for k, v in aws_lambda_function.functions : k => v.invoke_arn }
}

output "layer_arns" {
  description = "Lambda layer ARNs"
  value = {
    dependencies = aws_lambda_layer_version.dependencies.arn
    scipy        = aws_lambda_layer_version.scipy.arn
  }
}

output "simulation_queue_url" {
  description = "SQS queue URL for simulations"
  value       = aws_sqs_queue.simulation_queue.url
}

output "embeddings_queue_url" {
  description = "SQS queue URL for embeddings generation"
  value       = aws_sqs_queue.embeddings_queue.url
}

output "embeddings_queue_arn" {
  description = "SQS queue ARN for embeddings generation"
  value       = aws_sqs_queue.embeddings_queue.arn
}
