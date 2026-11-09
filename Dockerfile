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
    HELPMINTHS_AUTO_STORAGE=1 \
    HELPMINTHS_DASHBOARD_SOURCE=google_sheets \
    HELPMINTHS_SHEETS_ENABLED=1 \
    HELPMINTHS_SHEETS_ID=1pvGSBJEykTf5NUEsd3SqVdOqpYbpibTj07p23yJ5o-8 \
    HELPMINTHS_SHEETS_GID="" \
    HELPMINTHS_SHEETS_PUBLIC_AGGREGATES=1 \
    HELPMINTHS_SHEETS_COLUMN_MAPPING="{\"preset\":\"health2-kpd-school-v1\"}" \
    HELPMINTHS_SHEETS_REFRESH_SECONDS=30 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    YOLO_OFFLINE=true \
    YOLO_AUTOINSTALL=false \
    YOLO_CONFIG_DIR=/tmp/helpminths-yolo \
    MPLCONFIGDIR=/tmp/helpminths-matplotlib \
    PORT=8000
COPY backend/requirements.lock ./backend/requirements.lock
RUN python -m pip install --no-cache-dir -r backend/requirements.lock
COPY backend ./backend
COPY models ./models
ARG HELPMINTHS_FETCH_MODEL=1
ARG HELPMINTHS_MODEL_URL=""
ARG HELPMINTHS_MODEL_ARCHIVE_MEMBER=""
ARG HELPMINTHS_MODEL_SHA256=""
# The owner's selected source is fetched where the application is built. A
# selected-source failure stops the build rather than using unrelated weights.
RUN if [ "$HELPMINTHS_FETCH_MODEL" = "1" ]; then \
      python -m backend.model_artifact --config models/source.json --output models/parasite_yolo.pt; \
    elif [ "$HELPMINTHS_FETCH_MODEL" != "0" ]; then \
      printf '%s\n' 'HELPMINTHS_FETCH_MODEL must be 0 or 1' >&2; exit 2; \
    fi
# Keep the ordinary application lightweight until the owner's named checkpoint
# is present. A model build installs CPU wheels, never a CUDA dependency stack.
RUN if [ -f /app/models/parasite_yolo.pt ]; then \
      apt-get update && \
      apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
      rm -rf /var/lib/apt/lists/* && \
      python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu 'torch==2.5.1+cpu' 'torchvision==0.20.1+cpu' && \
      python -m pip freeze | grep -Ei '^(torch|torchvision)==' > /tmp/helpminths-cpu-constraints.txt && \
      python -m pip install --no-cache-dir -c /tmp/helpminths-cpu-constraints.txt -c backend/requirements.lock -r backend/requirements-model.txt && \
      python -m pip check && \
      python -m backend.verify_model --model /app/models/parasite_yolo.pt && \
      rm /tmp/helpminths-cpu-constraints.txt; \
    fi
COPY --from=frontend /build/dist ./dist
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/api/health', timeout=3)"
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
