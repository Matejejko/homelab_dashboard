FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# conntrack CLI: reads the kernel connection-tracking table for /api/network
# (the /proc file is gone on newer kernels, only netlink / the CLI is left)
RUN apt-get update \
    && apt-get install -y --no-install-recommends conntrack \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY services.json .

EXPOSE 8000

# hostNetwork makes the pod address the node address: the Service and the
# kubelet probes reach this port through it, so it cannot bind to loopback.
# Authentication is enforced in the app for exactly that reason.
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
