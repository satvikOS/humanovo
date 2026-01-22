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
