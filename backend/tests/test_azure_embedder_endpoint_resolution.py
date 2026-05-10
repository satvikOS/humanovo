"""Pure-config unit test: AzureOpenAIEmbedder picks the Foundry
endpoint when the new AZURE_AI_FOUNDRY_OPENAI_ENDPOINT secret is set,
falls back through the legacy chain otherwise, and strips any baked-in
/openai/v1 path the secret may have included.

No live API calls — exercises only the resolution logic in
`AzureOpenAIEmbedder.initialize()`."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from app.rag.embeddings import (
    AzureOpenAIEmbedder,
    EmbeddingConfig,
    EmbeddingModel,
)


def _config() -> EmbeddingConfig:
    return EmbeddingConfig.for_model(EmbeddingModel.AZURE_EMBEDDING_LARGE)


@pytest.mark.asyncio
async def test_foundry_endpoint_takes_priority_over_legacy():
    """When AZURE_AI_FOUNDRY_OPENAI_ENDPOINT is set, the embedder
    should use it even if the legacy AZURE_EMBEDDING_ENDPOINT or
    AZURE_OPENAI_ENDPOINT are also set."""
    embedder = AzureOpenAIEmbedder(_config())
    captured: dict = {}

    class FakeAzureOpenAI:
        def __init__(self, *, api_key, azure_endpoint, api_version):
            captured["endpoint"] = azure_endpoint
            captured["api_key"] = api_key
            captured["api_version"] = api_version

    with patch("app.rag.embeddings.settings") as mock_settings, \
         patch("openai.AsyncAzureOpenAI", FakeAzureOpenAI):
        mock_settings.AZURE_AI_FOUNDRY_OPENAI_ENDPOINT = "https://hub.openai.azure.com/openai/v1"
        mock_settings.azure_ai_foundry_key_value = "foundry-key"
        mock_settings.AZURE_EMBEDDING_ENDPOINT = "https://legacy.example/"
        mock_settings.azure_embedding_key_value = "legacy-key"
        mock_settings.AZURE_OPENAI_ENDPOINT = "https://shared.example/"
        mock_settings.azure_openai_api_key_value = "shared-key"
        mock_settings.AZURE_GPT4O_ENDPOINT = "https://gpt4o.example/"
        mock_settings.AZURE_EMBEDDING_API_VERSION = "2024-12-01-preview"

        await embedder.initialize()

    # /openai/v1 suffix should be stripped — AsyncAzureOpenAI appends
    # the deployment path itself.
    assert captured["endpoint"] == "https://hub.openai.azure.com"
    assert captured["api_key"] == "foundry-key"


@pytest.mark.asyncio
async def test_falls_back_to_legacy_when_foundry_unset():
    """If AZURE_AI_FOUNDRY_OPENAI_ENDPOINT is empty, the embedder
    should use AZURE_EMBEDDING_ENDPOINT next."""
    embedder = AzureOpenAIEmbedder(_config())
    captured: dict = {}

    class FakeAzureOpenAI:
        def __init__(self, *, api_key, azure_endpoint, api_version):
            captured["endpoint"] = azure_endpoint
            captured["api_key"] = api_key

    with patch("app.rag.embeddings.settings") as mock_settings, \
         patch("openai.AsyncAzureOpenAI", FakeAzureOpenAI):
        mock_settings.AZURE_AI_FOUNDRY_OPENAI_ENDPOINT = ""
        mock_settings.azure_ai_foundry_key_value = None
        mock_settings.AZURE_EMBEDDING_ENDPOINT = "https://legacy.example/"
        mock_settings.azure_embedding_key_value = "legacy-key"
        mock_settings.AZURE_OPENAI_ENDPOINT = "https://shared.example/"
        mock_settings.azure_openai_api_key_value = "shared-key"
        mock_settings.AZURE_GPT4O_ENDPOINT = "https://gpt4o.example/"
        mock_settings.AZURE_EMBEDDING_API_VERSION = "2024-12-01-preview"

        await embedder.initialize()

    assert captured["endpoint"] == "https://legacy.example/"
    assert captured["api_key"] == "legacy-key"


def test_get_deployment_prefers_pinned_foundry_name():
    """When AZURE_FOUNDRY_DEPLOYMENT_EMBED_LARGE is set (pinned by
    the smoke), it should win over the legacy
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT_LARGE."""
    embedder = AzureOpenAIEmbedder(_config())

    with patch("app.rag.embeddings.settings") as mock_settings:
        mock_settings.AZURE_FOUNDRY_DEPLOYMENT_EMBED_LARGE = "text-embedding-3-large"
        mock_settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_LARGE = "legacy-name"
        mock_settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "ignored"
        assert embedder._get_deployment() == "text-embedding-3-large"

    with patch("app.rag.embeddings.settings") as mock_settings:
        mock_settings.AZURE_FOUNDRY_DEPLOYMENT_EMBED_LARGE = ""
        mock_settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_LARGE = "legacy-name"
        mock_settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "ignored"
        assert embedder._get_deployment() == "legacy-name"
