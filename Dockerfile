FROM node:24-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM python:3.12-slim AS application
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HELPMINTHS_SERVE_WEB=1 \
    PORT=8000
COPY backend/requirements.lock ./backend/requirements.lock
RUN python -m pip install --no-cache-dir -r backend/requirements.lock
COPY backend ./backend
COPY models ./models
# Keep the ordinary application lightweight until the owner's named checkpoint
# is present. A model build installs CPU wheels, never a CUDA dependency stack.
RUN if [ -f /app/models/parasite_yolo.pt ]; then \
      apt-get update && \
      apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
      rm -rf /var/lib/apt/lists/* && \
      python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision && \
      python -m pip freeze | grep -Ei '^(torch|torchvision)==' > /tmp/helpminths-cpu-constraints.txt && \
      python -m pip install --no-cache-dir -c /tmp/helpminths-cpu-constraints.txt -c backend/requirements.lock -r backend/requirements-model.txt && \
      python -m pip check && rm /tmp/helpminths-cpu-constraints.txt; \
    fi
COPY --from=frontend /build/dist ./dist
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/api/health', timeout=3)"
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
