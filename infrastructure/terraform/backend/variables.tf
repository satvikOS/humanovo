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

variable "provisioned_concurrency" {
  description = <<-EOT
    Number of always-warm Lambda execution environments held on the
    `live` alias. The backend container image is large enough that a
    cold start can exceed API Gateway's 30s integration timeout,
    producing intermittent 500s after the function goes idle.
    Provisioned concurrency keeps this many environments initialised
    so beta traffic never hits a cold start.

    Costs ~$22/month per unit at 2048 MB. 1 is enough for the private
    beta's handful of named users; bump it if concurrent usage grows.
    Set to 0 to disable provisioned concurrency entirely.

    NOTE: kept at 0 until the AWS account's Lambda "Concurrent
    executions" service quota is raised above the new-account default
    of 10. Provisioned concurrency reserves from the account pool and
    AWS requires >=10 unreserved to remain, so ANY value > 0 is
    rejected while the quota is 10 (InvalidParameterValueException).
    Once the quota increase lands (see the request-lambda-quota
    workflow), set this to 1 and re-run the bootstrap workflow.
  EOT
  type        = number
  default     = 0
}

variable "enable_custom_domain" {
  description = <<-EOT
    Whether to provision the api.humanovo.net custom domain — ACM
    cert + DNS validation records + API Gateway domain mapping +
    A/AAAA alias records.

    Default false. The ACM DNS-validation step only succeeds when
    humanovo.net's public DNS delegation points at this account's
    Route53 zone. Until that registrar-level delegation is done the
    cert sits PENDING_VALIDATION and the validation resource times
    out after 75 min, failing the whole bootstrap (observed on run
    25949374262).

    With this false, the bootstrap completes and the app reaches the
    backend via the raw regional invoke URL (the `api_gateway_url`
    output, *.execute-api.<region>.amazonaws.com) — fully functional.
    Flip to true once humanovo.net DNS is delegated to Route53.
  EOT
  type        = bool
  default     = false
}
