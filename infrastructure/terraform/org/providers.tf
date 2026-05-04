provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Brand     = var.brand
      ManagedBy = "terraform"
      Module    = "org"
    }
  }
}
