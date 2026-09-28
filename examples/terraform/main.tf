# Cloudonym + Terraform example (GCP)
#
# 1. POST the five context values to Cloudonym's /v1/generate
# 2. Use the generated GCP VM name and labels on google_compute_instance
# 3. Block apply unless the name is valid and the labels have no violations
#
# Only the http data source talks to Cloudonym. The name rules live in the API, not here.

terraform {
  required_version = ">= 1.5"

  required_providers {
    http = {
      source  = "hashicorp/http"
      version = "~> 3.6"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 8.4"
    }
  }
}

# ---------------------------------------------------------------------------
# Cloudonym API
# ---------------------------------------------------------------------------

variable "cloudonym_api_url" {
  type        = string
  description = "Base URL of a Cloudonym deployment, without a trailing slash and without /v1 (for example the URL printed by `npm run dev`, or your own workers.dev / custom domain). There is no default: set it in terraform.tfvars or with -var."

  validation {
    condition     = can(regex("^https?://[^/]+(/.*[^/])?$", var.cloudonym_api_url))
    error_message = "cloudonym_api_url must start with http:// or https:// and must not end with a slash."
  }
}

# ---------------------------------------------------------------------------
# The five naming context values (sent as-is; the API normalizes them)
# ---------------------------------------------------------------------------

variable "owner" {
  type        = string
  description = "Team or owner of the resource (e.g. \"platform\")."
}

variable "system" {
  type        = string
  description = "System or service name (e.g. \"payments\")."
}

variable "purpose" {
  type        = string
  description = "What the resource does (e.g. \"batch\")."
}

variable "env" {
  type        = string
  description = "Environment. Canonical codes: prd, stg, dev, sbx (the API also accepts common aliases such as prod)."
}

variable "region" {
  type        = string
  description = "Cloudonym region code used in the name: kr, us, jp, eu, global. This is NOT a GCP location - see gcp_zone."
}

# ---------------------------------------------------------------------------
# GCP placement (not part of the name)
# ---------------------------------------------------------------------------

variable "gcp_project" {
  type        = string
  description = "GCP project ID to create the VM in."
}

variable "gcp_zone" {
  type        = string
  description = "GCP zone for the VM (e.g. asia-northeast3-a)."
  default     = "asia-northeast3-a"
}

variable "machine_type" {
  type        = string
  description = "Compute Engine machine type."
  default     = "e2-small"
}

variable "boot_image" {
  type        = string
  description = "Boot disk image."
  default     = "debian-cloud/debian-12"
}

provider "google" {
  project = var.gcp_project
  zone    = var.gcp_zone
}

# ---------------------------------------------------------------------------
# Ask Cloudonym for the name
# ---------------------------------------------------------------------------

data "http" "cloudonym" {
  url    = "${var.cloudonym_api_url}/v1/generate"
  method = "POST"

  request_headers = {
    Content-Type = "application/json"
    Accept       = "application/json"
  }

  request_body = jsonencode({
    context = {
      owner   = var.owner
      system  = var.system
      purpose = var.purpose
      env     = var.env
      region  = var.region
    }
    providers = ["gcp"]
  })

  lifecycle {
    # A 400 body has no data.gcp - fail here with the API's own errors instead of an "unsupported attribute" later
    postcondition {
      condition     = self.status_code == 200
      error_message = "Cloudonym /v1/generate returned HTTP ${self.status_code}: ${self.response_body}"
    }
  }
}

locals {
  cloudonym = jsondecode(data.http.cloudonym.response_body)

  # Response paths (see public/openapi.json):
  #   data.gcp.compute_instance.{name, valid, violations}
  #   metadata.generated_labels.gcp   (map of label key -> value)
  #   metadata.label_violations.gcp   (list of strings; empty when all labels are valid)
  vm               = local.cloudonym.data.gcp.compute_instance
  labels           = local.cloudonym.metadata.generated_labels.gcp
  label_violations = local.cloudonym.metadata.label_violations.gcp
}

# ---------------------------------------------------------------------------
# The VM
# ---------------------------------------------------------------------------

resource "google_compute_instance" "this" {
  name         = local.vm.name
  machine_type = var.machine_type
  zone         = var.gcp_zone
  labels       = local.labels

  boot_disk {
    initialize_params {
      image = var.boot_image
    }
  }

  network_interface {
    network = "default"
  }

  lifecycle {
    # Cloudonym never truncates silently: an invalid name comes back with valid = false and the reasons.
    precondition {
      condition     = local.vm.valid == true && length(local.label_violations) == 0
      error_message = "Cloudonym refused this context. name=\"${local.vm.name}\" valid=${local.vm.valid} name_violations=${jsonencode(local.vm.violations)} label_violations=${jsonencode(local.label_violations)}"
    }
  }
}

output "instance_name" {
  description = "Name generated by Cloudonym."
  value       = local.vm.name
}

output "instance_labels" {
  description = "Labels generated by Cloudonym."
  value       = local.labels
}

output "cloudonym_reason" {
  description = "How Cloudonym built the name (omit / shorten steps)."
  value       = local.cloudonym.data.gcp.compute_instance.reason
}
