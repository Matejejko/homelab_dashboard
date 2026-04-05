FROM python:3.12-slim

WORKDIR /app

# conntrack CLI — needed to read kernel connection tracking table
# (proc file removed in newer kernels, only accessible via netlink/CLI)
RUN apt-get update && apt-get install -y --no-install-recommends conntrack && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY services.json .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
