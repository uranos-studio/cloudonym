# Cloudonym + Terraform example (GCP)
#
# 1. POST the five context values to Cloudonym's /v1/generate
# 2. Use the generated GCP VM name and labels on google_compute_instance
# 3. Block apply unless the name is valid and the labels have no violations (API mode only - pinned values are not checked)
# 4. Keep the name stable: once the VM exists its name is never changed by a later rules revision
#    (lifecycle ignore_changes), and var.pinned skips the API entirely
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
  description = "Base URL of a Cloudonym deployment, without a trailing slash and without /v1 (your own workers.dev / custom domain over https://, or for local development the http://localhost:PORT URL printed by `npm run dev`). There is no default: set it in terraform.tfvars or with -var."

  # https:// only, except plain http:// to localhost / 127.0.0.1 for local development.
  # Over plain http an on-path attacker could rewrite the response and put a name or label of their choosing on the resource.
  # The host is anchored (optional :port, then / or end) so http://localhost.example.com does not pass.
  validation {
    condition = (
      can(regex("^https://[^/]+(/.*[^/])?$", var.cloudonym_api_url)) ||
      can(regex("^http://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?(/.*[^/])?$", var.cloudonym_api_url))
    )
    error_message = "cloudonym_api_url must start with https:// (plain http:// is allowed only for localhost or 127.0.0.1) and must not end with a slash."
  }
}

# ---------------------------------------------------------------------------
# Name stability (see README: "Pinned mode")
# ---------------------------------------------------------------------------

variable "rules_version" {
  type        = string
  description = "Optional rules revision (YYYY-MM-DD.N) to pin the API call to. If Cloudonym's current revision differs, the API answers 409 instead of returning names that may differ. null = use the current rules."
  default     = null
}

variable "pinned" {
  type = object({
    name   = string
    labels = map(string)
  })
  description = "Name and labels you already created. When set, Cloudonym is not called at all (the http data source has count = 0) - the recovery path after a 409 or when the API is unreachable. Pinned values are NOT checked by Cloudonym: the example makes no validity claim for them."
  default     = null
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
  description = "Environment. Canonical codes: prod, stg, dev, sbx, qa, uat, test, perf, dr (the API also accepts common aliases such as prd or production)."
}

variable "region" {
  type        = string
  description = "Region input for the name: a Google Cloud region (asia-northeast3) or zone (asia-northeast3-a), by name or by code. A zone resolves to its region, so the name carries the region code (ane3). It only shapes the name - the VM is placed by gcp_zone."
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
  # Pinned mode: no API call at all
  count = var.pinned == null ? 1 : 0

  url    = "${var.cloudonym_api_url}/v1/generate"
  method = "POST"

  request_headers = {
    Content-Type = "application/json"
    Accept       = "application/json"
  }

  request_body = jsonencode(merge(
    {
      context = {
        owner   = var.owner
        system  = var.system
        purpose = var.purpose
        env     = var.env
        region  = var.region
      }
      providers = ["gcp"]
    },
    var.rules_version == null ? {} : { rules_version = var.rules_version },
  ))

  lifecycle {
    # A failure body has no data.gcp - fail here with the API's own errors instead of an "unsupported attribute" later.
    # Every failure is { success: false, errors: [{ code, field?, params?, message }] }; 409 = request.rules_version_mismatch
    postcondition {
      condition     = self.status_code == 200
      error_message = "Cloudonym /v1/generate returned HTTP ${self.status_code}: ${self.response_body}"
    }
  }
}

locals {
  api = var.pinned == null ? jsondecode(data.http.cloudonym[0].response_body) : null

  # Response paths (see public/openapi.json):
  #   version                                   { engine, rules }
  #   data.gcp.compute_instance.{name, valid, violations, steps}
  #   metadata.generated_labels.gcp             (map of label key -> value)
  #   metadata.label_violations.gcp             (list of { code, field, params, message }; empty when all labels are valid)
  # Pinned mode makes no validity claim: nothing checked the pinned name, so vm_valid is null there, not true
  vm_name          = var.pinned != null ? var.pinned.name : local.api.data.gcp.compute_instance.name
  vm_valid         = var.pinned != null ? null : local.api.data.gcp.compute_instance.valid
  labels           = var.pinned != null ? var.pinned.labels : tomap(local.api.metadata.generated_labels.gcp)
  name_violations  = var.pinned != null ? [] : [for v in local.api.data.gcp.compute_instance.violations : v.message]
  label_violations = var.pinned != null ? [] : [for v in local.api.metadata.label_violations.gcp : v.message]
}

# ---------------------------------------------------------------------------
# The VM
# ---------------------------------------------------------------------------

resource "google_compute_instance" "this" {
  name         = local.vm_name
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
    # A new rules revision may produce a different name for the same context. Renaming a VM means destroy + create,
    # so once the VM exists its name is kept. To rename on purpose, remove this line and apply.
    ignore_changes = [name]

    # Cloudonym never truncates silently: an invalid name comes back with valid = false and the reasons.
    # API mode only - in pinned mode Cloudonym is not called, so this check does not apply (the pinned name is yours to vouch for).
    # ignore_changes does not skip this: in API mode the precondition still evaluates the NEW candidate name on every plan,
    # so a later rules revision that rejects the context blocks apply even though the existing VM keeps its old name.
    precondition {
      condition     = var.pinned != null || (local.vm_valid == true && length(local.label_violations) == 0)
      error_message = "Cloudonym refused this context. name=\"${local.vm_name}\" valid=${jsonencode(local.vm_valid)} name_violations=${jsonencode(local.name_violations)} label_violations=${jsonencode(local.label_violations)}"
    }
  }
}

output "instance_name" {
  description = "Name of the VM as it exists (the resource attribute, not the API's latest candidate)."
  value       = google_compute_instance.this.name
}

output "instance_labels" {
  description = "Labels applied to the VM."
  value       = local.labels
}

output "cloudonym_valid" {
  description = "Cloudonym's verdict on the candidate name (true / false). null in pinned mode: pinned names are not checked by Cloudonym."
  value       = local.vm_valid
}

output "cloudonym_candidate_name" {
  description = "Name Cloudonym proposes now (or the pinned name). May differ from instance_name after a rules revision - ignore_changes keeps the existing VM."
  value       = local.vm_name
}

output "cloudonym_steps" {
  description = "How Cloudonym built the name (dropped / shortened / normalised steps). Empty in pinned mode."
  value       = var.pinned != null ? [] : [for s in local.api.data.gcp.compute_instance.steps : s.message]
}

output "cloudonym_version" {
  description = "Engine and rules revision that produced the name (null in pinned mode). Pass version.rules as rules_version to be told (409) when the rules change."
  value       = var.pinned != null ? null : local.api.version
}
