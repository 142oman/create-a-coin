FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Standard library only: nothing to install. The app needs the code, the web files and the generated world.
COPY ladder ./ladder
COPY web ./web
COPY data ./data
COPY README.md ./

RUN useradd --system --no-create-home app && chown -R app /app
USER app

# The host sets PORT; the server listens on all interfaces when it is set.
CMD ["python", "-m", "ladder", "serve"]
