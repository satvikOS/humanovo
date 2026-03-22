# GenUp API Gateway Module - HTTP API Configuration

variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "lambda_functions" {
  type = map(string)
}

variable "lambda_invoke_arns" {
  type = map(string)
}

variable "cors_allowed_origins" {
  type = list(string)
}

variable "enable_jwt_auth" {
  type    = bool
  default = false
}

variable "jwt_issuer" {
  type    = string
  default = ""
}

variable "jwt_audience" {
  type    = list(string)
  default = []
}

# Static list of functions that need API Gateway integrations
# This must be defined statically so Terraform can determine for_each keys at plan time
locals {
  api_integrated_functions = toset([
    "api_core",
    "projects",
    "hypotheses",
    "evidence",
    "knowledge",
    "hypothesis_generation",
    "agent_orchestrator",
    "search_agent",
    "embeddings",
    "simulation"
  ])
}

# ==================== HTTP API ====================

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"
  description   = "GenUp Biomedical Discovery Platform API"

  cors_configuration {
    # allow_credentials cannot be true when allow_origins contains "*"
    allow_credentials = contains(var.cors_allowed_origins, "*") ? false : true
    allow_headers     = ["Content-Type", "Authorization", "X-Request-ID", "X-Api-Key"]
    allow_methods     = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_origins     = var.cors_allowed_origins
    expose_headers    = ["X-Request-ID", "X-Total-Count"]
    max_age           = 7200
  }

  tags = {
    Name = "${var.name_prefix}-api"
  }
}

# ==================== JWT Authorizer (optional) ====================

resource "aws_apigatewayv2_authorizer" "jwt" {
  count = var.enable_jwt_auth ? 1 : 0

  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.name_prefix}-jwt-authorizer"

  jwt_configuration {
    audience = var.jwt_audience
    issuer   = var.jwt_issuer
  }
}

# ==================== Lambda Integrations ====================

resource "aws_apigatewayv2_integration" "lambda" {
  for_each = local.api_integrated_functions

  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.lambda_invoke_arns[each.key]
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

# ==================== Routes ====================

# Health Check
resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["api_core"].id}"
}

# Projects Routes
resource "aws_apigatewayv2_route" "projects_list" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/projects"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["projects"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "projects_create" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /api/v1/projects"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["projects"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "projects_get" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/projects/{projectId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["projects"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "projects_update" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PATCH /api/v1/projects/{projectId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["projects"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "projects_delete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /api/v1/projects/{projectId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["projects"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "projects_hypotheses" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/projects/{projectId}/hypotheses"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["projects"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "projects_stats" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/projects/{projectId}/stats"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["projects"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

# Hypotheses Routes
resource "aws_apigatewayv2_route" "hypotheses_list" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/hypotheses"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["hypotheses"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "hypotheses_create" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /api/v1/hypotheses"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["hypotheses"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "hypotheses_get" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/hypotheses/{hypothesisId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["hypotheses"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "hypotheses_update" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PATCH /api/v1/hypotheses/{hypothesisId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["hypotheses"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

# Hypothesis Generation
resource "aws_apigatewayv2_route" "hypotheses_generate" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /api/v1/hypotheses/generate"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["hypothesis_generation"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

# Evidence Routes
resource "aws_apigatewayv2_route" "evidence_search" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/evidence"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["evidence"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "evidence_get" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/evidence/{evidenceId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["evidence"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

# Knowledge Graph Routes
resource "aws_apigatewayv2_route" "knowledge_entities_search" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/knowledge/entities"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["knowledge"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "knowledge_entity_get" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/knowledge/entities/{entityId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["knowledge"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "knowledge_neighborhood" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/knowledge/entities/{entityId}/neighborhood"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["knowledge"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "knowledge_paths" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/knowledge/paths"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["knowledge"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "knowledge_stats" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/knowledge/stats"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["knowledge"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

# Simulation Routes
resource "aws_apigatewayv2_route" "simulations_list" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/simulations"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["simulation"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "simulations_create" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /api/v1/simulations"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["simulation"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "simulations_get" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/simulations/{simulationId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["simulation"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "simulations_cancel" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /api/v1/simulations/{simulationId}/cancel"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["simulation"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

# Agent Routes
resource "aws_apigatewayv2_route" "agents_tasks_create" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /api/v1/agents/tasks"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "agents_tasks_get" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/v1/agents/tasks/{taskId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_apigatewayv2_route" "agents_search" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /api/v1/agents/search"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["search_agent"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

# Orchestrator Routes (Discovery UI)
resource "aws_apigatewayv2_route" "orchestrator_status" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/v1/orchestrator/status"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_start" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/start"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_pause" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/pause"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_resume" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/resume"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_stop" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/stop"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/v1/orchestrator/health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_reset" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/reset"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_chat" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/chat"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_paper" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/generate-paper/markdown"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_save_to_project" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/save-to-project"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_paper_status" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/v1/orchestrator/paper-status"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_cancel_paper" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/cancel-paper"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "orchestrator_paper_pdf" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/orchestrator/generate-paper/pdf"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

# Document endpoints (hypothesis PDF/HTML export via agent_orchestrator Lambda)
resource "aws_apigatewayv2_route" "document_hypothesis_pdf" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/documents/hypothesis/{hypothesisId}/pdf"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

resource "aws_apigatewayv2_route" "document_hypothesis_html" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/documents/hypothesis/{hypothesisId}/html"
  target    = "integrations/${aws_apigatewayv2_integration.lambda["agent_orchestrator"].id}"
}

# Embeddings
resource "aws_apigatewayv2_route" "embeddings_create" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /api/v1/embeddings"
  target             = "integrations/${aws_apigatewayv2_integration.lambda["embeddings"].id}"
  authorization_type = var.enable_jwt_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_jwt_auth ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

# ==================== Stage ====================

resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = var.environment
  auto_deploy = true

  # Access logging disabled - requires logs:CreateLogDelivery permission
  # Uncomment and grant permission to enable access logging
  # access_log_settings {
  #   destination_arn = aws_cloudwatch_log_group.api_gateway.arn
  #   format = jsonencode({
  #     requestId         = "$context.requestId"
  #     ip                = "$context.identity.sourceIp"
  #     requestTime       = "$context.requestTime"
  #     httpMethod        = "$context.httpMethod"
  #     routeKey          = "$context.routeKey"
  #     status            = "$context.status"
  #     protocol          = "$context.protocol"
  #     responseLength    = "$context.responseLength"
  #     integrationError  = "$context.integrationErrorMessage"
  #     integrationLatency = "$context.integrationLatency"
  #   })
  # }

  default_route_settings {
    throttling_burst_limit = 2000
    throttling_rate_limit  = 1000
  }

  tags = {
    Name = "${var.name_prefix}-api-stage"
  }
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${var.name_prefix}-api"
  retention_in_days = var.environment == "prod" ? 90 : 14

  tags = {
    Name = "${var.name_prefix}-api-gateway-logs"
  }
}

# ==================== Outputs ====================

output "api_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.main.id
}

output "api_endpoint" {
  description = "API Gateway endpoint"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "stage_url" {
  description = "API Gateway stage URL"
  value       = aws_apigatewayv2_stage.main.invoke_url
}

output "stage_name" {
  description = "API Gateway stage name"
  value       = aws_apigatewayv2_stage.main.name
}
