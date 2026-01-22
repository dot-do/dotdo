#!/bin/bash
set -e

echo "=========================================="
echo "ClickHouse S3-backed Storage Entrypoint"
echo "=========================================="

# Substitute environment variables in storage.xml template
if [ -f /etc/clickhouse-server/config.d/storage.xml.template ]; then
    echo "Processing storage.xml.template..."
    envsubst '${S3_ENDPOINT} ${S3_ACCESS_KEY} ${S3_SECRET_KEY} ${S3_BUCKET} ${S3_REGION} ${CACHE_SIZE}' \
        < /etc/clickhouse-server/config.d/storage.xml.template \
        > /etc/clickhouse-server/config.d/storage.xml

    # Ensure proper ownership
    chown clickhouse:clickhouse /etc/clickhouse-server/config.d/storage.xml
    echo "storage.xml generated successfully"
fi

# Substitute environment variables in storage_policies.xml.template if it exists
if [ -f /etc/clickhouse-server/config.d/storage_policies.xml.template ]; then
    echo "Processing storage_policies.xml.template..."
    envsubst '${S3_ENDPOINT} ${S3_ACCESS_KEY} ${S3_SECRET_KEY} ${S3_BUCKET} ${S3_REGION} ${CACHE_SIZE}' \
        < /etc/clickhouse-server/config.d/storage_policies.xml.template \
        > /etc/clickhouse-server/config.d/storage_policies.xml

    chown clickhouse:clickhouse /etc/clickhouse-server/config.d/storage_policies.xml
    echo "storage_policies.xml generated successfully"
fi

# Validate required environment variables for S3 storage
if [ -n "$S3_ENDPOINT" ]; then
    if [ -z "$S3_ACCESS_KEY" ] || [ -z "$S3_SECRET_KEY" ]; then
        echo "Warning: S3_ENDPOINT is set but S3_ACCESS_KEY or S3_SECRET_KEY is missing"
        echo "S3 storage will not function correctly"
    else
        echo ""
        echo "S3/R2 storage configured:"
        echo "  Endpoint: $S3_ENDPOINT"
        echo "  Bucket: ${S3_BUCKET:-clickhouse-data}"
        echo "  Region: ${S3_REGION:-auto}"
        echo "  Cache Size: ${CACHE_SIZE:-10G}"
        echo ""
    fi
else
    echo ""
    echo "S3_ENDPOINT not set - using local storage only"
    echo ""
    # Remove S3 storage config if no S3 endpoint provided
    rm -f /etc/clickhouse-server/config.d/storage.xml
    rm -f /etc/clickhouse-server/config.d/storage_policies.xml
    rm -f /etc/clickhouse-server/config.d/s3_settings.xml
    rm -f /etc/clickhouse-server/config.d/system_tables.xml
fi

# Ensure cache and metadata directories exist with proper permissions
echo "Setting up directories..."
mkdir -p /var/lib/clickhouse/disks/cache
mkdir -p /var/lib/clickhouse/disks/s3
chown -R clickhouse:clickhouse /var/lib/clickhouse/disks
chown -R clickhouse:clickhouse /var/lib/clickhouse

echo "=========================================="
echo "Starting ClickHouse server..."
echo "=========================================="

# Execute the main command
exec "$@"
