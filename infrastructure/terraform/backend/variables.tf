# humanovo Backend stack — input variables
#
# Kept deliberately small: this stack is the closed-beta production
# environment, so most knobs are hardcoded in main.tf. The variables
# here are the toggles a founder/operator might flip via the
# bootstrap workflow's `workflow_dispatch` inputs without editing HCL.

variable "aws_region" {
  description = "AWS region for the backend stack."
  type        = string
  default     = "us-east-1"
}

variable "production_nat" {
  description = <<-EOT
    NAT layer toggle. Closed-beta default (false) is fck-nat on a
    t4g.nano in the AZ-a public subnet — about $3/month and good
    enough for the synthetic load Lambda hits while we're pre-revenue.
    Flip to true for a managed NAT Gateway (~$32/month + data) once
    we're past pre-revenue and need the SLA.
  EOT
  type        = bool
  default     = false
}

variable "lambda_image_uri" {
  description = <<-EOT
    Full ECR image URI (with tag or digest) for the Lambda function.
    Leave null to use a fallback `public.ecr.aws/lambda/python:3.12`
    placeholder so the very first apply can succeed before the
    bootstrap workflow has built and pushed an image. The deploy
    workflow then patches the function with the real image.
  EOT
  type        = string
  default     = null
}

variable "enable_jwt_authorizer" {
  description = <<-EOT
    Reserved for the JWT/Auth0 authorizer wiring. Keeping the flag
    in the stack now so we don't have to re-plumb variables when we
    flip the route auth from NONE → JWT in a follow-up PR. No-op
    until then.
  EOT
  type        = bool
  default     = false
}
