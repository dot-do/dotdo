FROM clickhouse/clickhouse-server:latest

# Install envsubst for environment variable substitution
RUN apt-get update && apt-get install -y gettext-base && rm -rf /var/lib/apt/lists/*

# Environment variables with defaults
ENV S3_ENDPOINT="" \
    S3_ACCESS_KEY="" \
    S3_SECRET_KEY="" \
    S3_BUCKET="clickhouse-data" \
    S3_REGION="auto" \
    CACHE_SIZE="10G" \
    MAX_MEMORY="4G" \
    MAX_THREADS="4"

# Copy configuration files
COPY config/ /etc/clickhouse-server/config.d/

# Set up entrypoint script for env var substitution
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create cache directory
RUN mkdir -p /var/lib/clickhouse/disks/cache && \
    mkdir -p /var/lib/clickhouse/disks/s3 && \
    chown -R clickhouse:clickhouse /var/lib/clickhouse

# Expose ports
# 8123 - HTTP interface
# 9000 - Native protocol
EXPOSE 8123 9000

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD clickhouse-client --query "SELECT 1" || exit 1

# Volume for cache persistence
VOLUME ["/var/lib/clickhouse/disks/cache"]

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["clickhouse-server", "--config-file=/etc/clickhouse-server/config.xml"]
