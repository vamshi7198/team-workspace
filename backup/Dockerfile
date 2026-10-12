FROM alpine:3.22
RUN apk add --no-cache postgresql17-client gnupg rclone tzdata
COPY backup.sh restore.sh entrypoint.sh /scripts/
RUN chmod +x /scripts/*.sh
ENV RCLONE_CONFIG=/config/rclone/rclone.conf
ENTRYPOINT ["/scripts/entrypoint.sh"]
