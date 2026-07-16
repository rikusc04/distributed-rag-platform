output "vpc_id" {
  value       = aws_vpc.this.id
  description = "VPC ID"
}

output "vpc_cidr" {
  value       = aws_vpc.this.cidr_block
  description = "VPC CIDR block"
}

output "public_subnet_ids" {
  value       = aws_subnet.public[*].id
  description = "IDs of public subnets (one per AZ)"
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "IDs of private subnets (one per AZ)"
}

output "nat_gateway_id" {
  value       = aws_nat_gateway.this.id
  description = "NAT gateway ID"
}

output "availability_zones" {
  value       = data.aws_availability_zones.available.names
  description = "AZs used"
}
