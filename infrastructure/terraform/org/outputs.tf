output "organization_id" {
  description = "AWS Organization ID."
  value       = local.enable_org ? aws_organizations_organization.this[0].id : null
}

output "organization_arn" {
  description = "AWS Organization ARN."
  value       = local.enable_org ? aws_organizations_organization.this[0].arn : null
}

output "account_ids" {
  description = "Map of env name to AWS account ID."
  value = local.enable_org ? {
    for k, v in aws_organizations_account.member : k => v.id
  } : {}
}

output "account_arns" {
  description = "Map of env name to AWS account ARN."
  value = local.enable_org ? {
    for k, v in aws_organizations_account.member : k => v.arn
  } : {}
}

output "ou_ids" {
  description = "Map of env name to organizational unit ID."
  value = local.enable_org ? {
    for k, v in aws_organizations_organizational_unit.env : k => v.id
  } : {}
}

output "sso_instance_arn" {
  description = "Identity Center instance ARN (if SSO is enabled)."
  value       = local.enable_sso ? local.sso_instance_arn : null
}

output "phase" {
  description = "Echo of the phase that was applied."
  value       = var.phase
}
