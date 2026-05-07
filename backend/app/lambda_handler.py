"""AWS Lambda entrypoint. Wraps the FastAPI app in Mangum for API Gateway v2 events."""
from mangum import Mangum
from app.main import app

# lifespan="off" because Lambda containers don't have a graceful shutdown
# hook that would let FastAPI's lifespan tasks run cleanly. Move any
# startup work to module import (it runs once per cold container).
handler = Mangum(app, lifespan="off")
