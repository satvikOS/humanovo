# GenUp DynamoDB Module - Table Configuration

variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "kms_key_arn" {
  type = string
}

variable "billing_mode" {
  type    = string
  default = "PAY_PER_REQUEST"
}

# ==================== Projects Table ====================

resource "aws_dynamodb_table" "projects" {
  name         = "${var.name_prefix}-projects"
  billing_mode = var.billing_mode
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "user_id-created_at-index"
    hash_key        = "user_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled = true
    # Using AWS managed encryption to avoid kms:CreateGrant permission requirement
    # kms_key_arn = var.kms_key_arn
  }

  point_in_time_recovery {
    enabled = var.environment == "prod"
  }

  tags = {
    Name = "${var.name_prefix}-projects"
  }
}

# ==================== Hypotheses Table ====================

resource "aws_dynamodb_table" "hypotheses" {
  name         = "${var.name_prefix}-hypotheses"
  billing_mode = var.billing_mode
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "project_id"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name            = "project_id-created_at-index"
    hash_key        = "project_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "project_id-status-index"
    hash_key        = "project_id"
    range_key       = "status"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled = true
    # Using AWS managed encryption to avoid kms:CreateGrant permission requirement
    # kms_key_arn = var.kms_key_arn
  }

  point_in_time_recovery {
    enabled = var.environment == "prod"
  }

  tags = {
    Name = "${var.name_prefix}-hypotheses"
  }
}

# ==================== Evidence Table ====================

resource "aws_dynamodb_table" "evidence" {
  name         = "${var.name_prefix}-evidence"
  billing_mode = var.billing_mode
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "hypothesis_id"
    type = "S"
  }

  attribute {
    name = "source_type"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "hypothesis_id-created_at-index"
    hash_key        = "hypothesis_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "source_type-index"
    hash_key        = "source_type"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled = true
    # Using AWS managed encryption to avoid kms:CreateGrant permission requirement
    # kms_key_arn = var.kms_key_arn
  }

  point_in_time_recovery {
    enabled = var.environment == "prod"
  }

  tags = {
    Name = "${var.name_prefix}-evidence"
  }
}

# ==================== Simulations Table ====================

resource "aws_dynamodb_table" "simulations" {
  name         = "${var.name_prefix}-simulations"
  billing_mode = var.billing_mode
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "project_id"
    type = "S"
  }

  attribute {
    name = "hypothesis_id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "project_id-created_at-index"
    hash_key        = "project_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "hypothesis_id-index"
    hash_key        = "hypothesis_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled = true
    # Using AWS managed encryption to avoid kms:CreateGrant permission requirement
    # kms_key_arn = var.kms_key_arn
  }

  point_in_time_recovery {
    enabled = var.environment == "prod"
  }

  tags = {
    Name = "${var.name_prefix}-simulations"
  }
}

# ==================== Knowledge Graph Metadata Table ====================

resource "aws_dynamodb_table" "knowledge_metadata" {
  name         = "${var.name_prefix}-knowledge-metadata"
  billing_mode = var.billing_mode
  hash_key     = "entity_id"
  range_key    = "relation_type"

  attribute {
    name = "entity_id"
    type = "S"
  }

  attribute {
    name = "relation_type"
    type = "S"
  }

  attribute {
    name = "entity_type"
    type = "S"
  }

  global_secondary_index {
    name            = "entity_type-index"
    hash_key        = "entity_type"
    range_key       = "entity_id"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled = true
    # Using AWS managed encryption to avoid kms:CreateGrant permission requirement
    # kms_key_arn = var.kms_key_arn
  }

  tags = {
    Name = "${var.name_prefix}-knowledge-metadata"
  }
}

# ==================== Agent Tasks Table ====================

resource "aws_dynamodb_table" "agent_tasks" {
  name         = "${var.name_prefix}-agent-tasks"
  billing_mode = var.billing_mode
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "project_id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "project_id-status-index"
    hash_key        = "project_id"
    range_key       = "status"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "status-created_at-index"
    hash_key        = "status"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
    # Using AWS managed encryption to avoid kms:CreateGrant permission requirement
    # kms_key_arn = var.kms_key_arn
  }

  tags = {
    Name = "${var.name_prefix}-agent-tasks"
  }
}

# ==================== Knowledge Base Table ====================

resource "aws_dynamodb_table" "knowledge" {
  name         = "${var.name_prefix}-knowledge"
  billing_mode = var.billing_mode
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "content_hash"
    type = "S"
  }

  attribute {
    name = "source"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  attribute {
    name = "embedding_status"
    type = "S"
  }

  # Hash index for deduplication
  global_secondary_index {
    name            = "hash-index"
    hash_key        = "content_hash"
    projection_type = "KEYS_ONLY"
  }

  # Source index for filtering by source
  global_secondary_index {
    name            = "source-created_at-index"
    hash_key        = "source"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  # Embedding status index for batch processing
  global_secondary_index {
    name            = "embedding_status-index"
    hash_key        = "embedding_status"
    range_key       = "created_at"
    projection_type = "KEYS_ONLY"
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = var.environment == "prod"
  }

  tags = {
    Name = "${var.name_prefix}-knowledge"
  }
}

# ==================== Embeddings Table ====================

resource "aws_dynamodb_table" "embeddings" {
  name         = "${var.name_prefix}-embeddings"
  billing_mode = var.billing_mode
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "source"
    type = "S"
  }

  global_secondary_index {
    name            = "source-index"
    hash_key        = "source"
    projection_type = "KEYS_ONLY"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${var.name_prefix}-embeddings"
  }
}

# ==================== Ingestion Checkpoints Table ====================

resource "aws_dynamodb_table" "ingestion_checkpoints" {
  name         = "${var.name_prefix}-ingestion-checkpoints"
  billing_mode = var.billing_mode
  hash_key     = "source"
  range_key    = "query_hash"

  attribute {
    name = "source"
    type = "S"
  }

  attribute {
    name = "query_hash"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${var.name_prefix}-ingestion-checkpoints"
  }
}

# ==================== Rate Limits Table ====================

resource "aws_dynamodb_table" "rate_limits" {
  name         = "${var.name_prefix}-rate-limits"
  billing_mode = var.billing_mode
  hash_key     = "limit_type"
  range_key    = "period"

  attribute {
    name = "limit_type"
    type = "S"
  }

  attribute {
    name = "period"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${var.name_prefix}-rate-limits"
  }
}

# ==================== RAG Cache Table ====================

resource "aws_dynamodb_table" "rag_cache" {
  name         = "${var.name_prefix}-rag-cache"
  billing_mode = var.billing_mode
  hash_key     = "cache_key"

  attribute {
    name = "cache_key"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${var.name_prefix}-rag-cache"
  }
}

# ==================== Ingestion State Table ====================

resource "aws_dynamodb_table" "ingestion_state" {
  name         = "${var.name_prefix}-ingestion-state"
  billing_mode = var.billing_mode
  hash_key     = "source"

  attribute {
    name = "source"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${var.name_prefix}-ingestion-state"
  }
}

# ==================== Outputs ====================

output "projects_table_name" {
  value = aws_dynamodb_table.projects.name
}

output "projects_table_arn" {
  value = aws_dynamodb_table.projects.arn
}

output "hypotheses_table_name" {
  value = aws_dynamodb_table.hypotheses.name
}

output "hypotheses_table_arn" {
  value = aws_dynamodb_table.hypotheses.arn
}

output "evidence_table_name" {
  value = aws_dynamodb_table.evidence.name
}

output "evidence_table_arn" {
  value = aws_dynamodb_table.evidence.arn
}

output "simulations_table_name" {
  value = aws_dynamodb_table.simulations.name
}

output "simulations_table_arn" {
  value = aws_dynamodb_table.simulations.arn
}

output "knowledge_metadata_table_name" {
  value = aws_dynamodb_table.knowledge_metadata.name
}

output "knowledge_metadata_table_arn" {
  value = aws_dynamodb_table.knowledge_metadata.arn
}

output "agent_tasks_table_name" {
  value = aws_dynamodb_table.agent_tasks.name
}

output "agent_tasks_table_arn" {
  value = aws_dynamodb_table.agent_tasks.arn
}

output "knowledge_table_name" {
  value = aws_dynamodb_table.knowledge.name
}

output "knowledge_table_arn" {
  value = aws_dynamodb_table.knowledge.arn
}

output "embeddings_table_name" {
  value = aws_dynamodb_table.embeddings.name
}

output "embeddings_table_arn" {
  value = aws_dynamodb_table.embeddings.arn
}

output "ingestion_checkpoints_table_name" {
  value = aws_dynamodb_table.ingestion_checkpoints.name
}

output "ingestion_checkpoints_table_arn" {
  value = aws_dynamodb_table.ingestion_checkpoints.arn
}

output "rate_limits_table_name" {
  value = aws_dynamodb_table.rate_limits.name
}

output "rate_limits_table_arn" {
  value = aws_dynamodb_table.rate_limits.arn
}

output "rag_cache_table_name" {
  value = aws_dynamodb_table.rag_cache.name
}

output "rag_cache_table_arn" {
  value = aws_dynamodb_table.rag_cache.arn
}

output "ingestion_state_table_name" {
  value = aws_dynamodb_table.ingestion_state.name
}

output "ingestion_state_table_arn" {
  value = aws_dynamodb_table.ingestion_state.arn
}
