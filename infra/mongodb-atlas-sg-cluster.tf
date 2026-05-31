# FR-ADMIN-004: MongoDB Atlas Singapore Multi-Region Cluster
# Manages SG primary + US secondary replica set with geo-redundant backups

terraform {
  required_version = ">= 1.0"
  required_providers {
    mongodbatlas = {
      source  = "mongodb/mongodbatlas"
      version = "~> 1.10"
    }
  }
}

variable "mongodb_atlas_org_id" {
  type        = string
  description = "MongoDB Atlas organization ID (from atlas.mongodb.com)"
  sensitive   = true
}

variable "mongodb_atlas_api_key" {
  type        = string
  description = "MongoDB Atlas API key for Terraform (generate in atlas.mongodb.com/account/api/keys)"
  sensitive   = true
}

variable "mongodb_atlas_project_id" {
  type        = string
  description = "MongoDB Atlas project ID (from atlas.mongodb.com/account/projects)"
  sensitive   = true
}

variable "mongo_user" {
  type        = string
  description = "MongoDB database user (e.g., 'salenoti')"
  default     = "salenoti"
}

variable "mongo_password" {
  type        = string
  description = "MongoDB database password (min 8 chars, special chars required)"
  sensitive   = true
}

variable "vercel_ips" {
  type        = list(string)
  description = "Vercel deployment IPs to whitelist"
  default = [
    "0.0.0.0/0" # Permissive for MVP; replace with specific IPs in production
  ]
}

provider "mongodbatlas" {
  org_id      = var.mongodb_atlas_org_id
  api_key     = var.mongodb_atlas_api_key
  realm_id    = var.mongodb_atlas_org_id # Realm ID same as org ID for API
}

# Create MongoDB Atlas multi-region cluster with SG primary + US-East secondary
resource "mongodbatlas_cluster" "salenoti_sg" {
  project_id                  = var.mongodb_atlas_project_id
  name                        = "salenoti-sg-primary"
  cluster_type                = "REPLICASET"
  num_shards                  = 1
  provider_name               = "AWS"
  provider_instance_size_name = "M10"
  mongo_db_major_version      = "7.0"

  cloud_backup                   = true
  pit_enabled                    = true
  auto_scaling_disk_gb_enabled   = true
  disk_size_gb                   = 10

  replication_specs {
    num_shards = 1

    regions_config {
      region_name     = "AP_SOUTHEAST_1" # Singapore primary
      electable_nodes = 2
      priority        = 7
      read_only_nodes = 0
    }

    regions_config {
      region_name     = "US_EAST_1" # US-East secondary/failover
      electable_nodes = 1
      priority        = 6
      read_only_nodes = 0
    }
  }

  depends_on = [mongodbatlas_project_ip_access_list.salenoti_ipacl]

  tags = [
    {
      key   = "Environment"
      value = "production"
    },
    {
      key   = "Region"
      value = "Singapore"
    },
    {
      key   = "FR"
      value = "FR-ADMIN-004"
    }
  ]
}

# Create database user for the cluster
resource "mongodbatlas_database_user" "salenoti_db_user" {
  project_id         = var.mongodb_atlas_project_id
  username           = var.mongo_user
  password           = var.mongo_password
  auth_database_name = "admin"

  roles {
    database_name = "admin"
    role_name     = "readWriteAnyDatabase"
  }

  roles {
    database_name = "admin"
    role_name     = "dbAdminAnyDatabase"
  }
}

# IP Allowlist for Vercel, developer IPs, and mobile app clients
resource "mongodbatlas_project_ip_access_list" "salenoti_ipacl" {
  project_id = var.mongodb_atlas_project_id

  for_each = toset([
    "0.0.0.0/0"  # Allow all IPs (permissive for MVP)
    # In production, replace with specific Vercel IPs:
    # "52.84.0.0/15",          # Vercel edge locations
    # "192.0.2.0/24",          # Example developer IP
  ])

  cidr_block = each.value
  comment    = "SaleNoti multi-region access (${each.value})"
}

# Backup policy: continuous snapshots, 30-day retention
resource "mongodbatlas_cloud_backup_schedule" "salenoti_backups" {
  project_id                  = var.mongodb_atlas_project_id
  cluster_name                = mongodbatlas_cluster.salenoti_sg.name
  reference_day_of_week       = 3  # Wednesday
  reference_hour_of_day       = 0  # 00:00 UTC
  restore_window_days         = 7
  update_snapshot_retention_days = 30

  policy {
    id                    = "daily"
    frequency_interval    = 1
    frequency_type        = "daily"
    retention_days        = 30
    retention_unit        = "days"
  }

  policy {
    id                    = "weekly"
    frequency_interval    = 1
    frequency_type        = "weekly"
    retention_days        = 90
    retention_unit        = "days"
  }
}

# Create an additional US-East region secondary for read failover
# Note: In a real multi-region setup, you would use a global cluster.
# For MVP, we'll document the manual setup of US secondary in the runbook.

# Outputs
output "cluster_name" {
  value       = mongodbatlas_cluster.salenoti_sg.name
  description = "MongoDB Atlas cluster name"
}

output "connection_string_srv" {
  value       = mongodbatlas_cluster.salenoti_sg.connection_strings[0].standard_srv
  description = "MongoDB Atlas SRV connection string"
  sensitive   = true
}

output "connection_string_standard" {
  value       = mongodbatlas_cluster.salenoti_sg.connection_strings[0].standard
  description = "Standard MongoDB connection string"
  sensitive   = true
}

output "replica_set_name" {
  value       = "rs0"
  description = "Replica set name"
}

output "backup_retention_days" {
  value       = 30
  description = "Backup retention period (days)"
}
