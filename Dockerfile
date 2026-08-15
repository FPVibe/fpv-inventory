FROM denoland/deno:2.2.1

WORKDIR /app

# Copy source files and vendored dependencies.
# Use *.ts glob so any new .ts file is automatically included;
# individual COPY lines caused a recurring class of bug (see issue #68).
COPY *.ts .
COPY deno.json .
COPY openapi.json .
COPY vendor/ vendor/

# Create data directories
RUN mkdir -p /data/photos

ENV DB_PATH=/data/fpv-inventory.db
ENV PHOTOS_DIR=/data/photos
ENV PORT=8000

EXPOSE 8000

# Run with only the permissions needed
CMD ["deno", "run", "--allow-net", "--allow-read=/app,/data", "--allow-write=/data", "--allow-env", "main.ts"]
