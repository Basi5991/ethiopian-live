"""Google Gemini integration with offline fallbacks."""

from __future__ import annotations

import json
import os
from typing import Any

from django.conf import settings

from .interpreter_matching import interpreter_supports_language_pair

_client = None


def is_ai_available() -> bool:
    return bool(getattr(settings, "GEMINI_API_KEY", ""))


def _get_client():
    global _client
    if _client is None and is_ai_available():
        from google import genai

        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client


def _generate(prompt: str, *, json_mode: bool = False, temperature: float = 0.3) -> str:
    client = _get_client()
    if not client:
        return ""

    config: dict[str, Any] = {"temperature": temperature}
    if json_mode:
        config["response_mime_type"] = "application/json"

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=config,
    )
    return (response.text or "").strip()


def translate_text(text: str, from_lang: str, to_lang: str, context: str = "") -> str:
    if not text or not from_lang or not to_lang:
        return ""

    if not is_ai_available():
        mock = {
            "how are you?": "እንዴት ነህ? (Amharic) / Akkam jirta? (Oromo)",
            "thank you": "አመሰግናለሁ (Amharic) / Galatoomi (Oromo)",
            "severe headache": "ከባድ ራስ ምታት (Amharic) / Mata-bowbii cimaa (Oromo)",
        }
        return mock.get(text.lower().strip(), f'[Mock Translate: "{text}" from {from_lang} to {to_lang}]')

    ctx = f" Context: {context}." if context else ""
    prompt = (
        f"Translate strictly from {from_lang} to {to_lang}.{ctx} "
        f'Output only the translated text with no preamble.\nText: "{text}"'
    )
    return _generate(prompt, temperature=0.2) or f"[Translation error for: {text}]"


def get_speech_caption(from_lang: str, to_lang: str, service_type: str) -> list[str]:
    mock_captions = {
        "medical": [
            "Patient: ካለፈው ሳምንት ጀምሮ ትንፋሽ ያጥረኛል፣ ሳልም አለብኝ።",
            "AI Interpreter (Oromo): Torban darbe irraa kaasee hafura na cirraha, qufaas qaba.",
            "Doctor: This strongly suggests standard respiratory infection. Let me check your lungs.",
            "AI Interpreter (Amharic): ይህ በከፍተኛ ሁኔታ የአየር መንገድ ኢንፌክሽንን ያሳያል።",
        ],
        "legal": [
            "Judge: ክሱ የቀረበው በዋስትና መብት ጥሰት ላይ ነው።",
            "Attorney: We urge the court to release my client on a standard 10,000 Birr bail.",
        ],
        "general": [
            "Client: ወደ ሸገር የምሄደው በየትኛው አውቶብስ ነው?",
            "Local Advisor: Take the fast city express from Meskel Square directly.",
        ],
    }
    key = service_type if service_type in mock_captions else "general"

    if not is_ai_available():
        return mock_captions[key]

    prompt = (
        f"Generate 6 realistic live interpretation dialogue lines for a {service_type} session "
        f"between {from_lang} and {to_lang} in Ethiopia. Return only a JSON array of strings."
    )
    raw = _generate(prompt, json_mode=True)
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(item) for item in data]
    except json.JSONDecodeError:
        pass
    return mock_captions[key]


def summarize_session_transcript(transcript_list: list[str]) -> dict[str, str]:
    if not transcript_list:
        return {"summary": "", "sentiment": "Neutral", "insights": ""}

    if not is_ai_available():
        return {
            "summary": (
                "This session successfully addressed clinical medical issues. "
                "The interpreter provided accurate definitions for symptoms."
            ),
            "sentiment": "Highly Positive",
            "insights": "Excellent fluency in medical Amharic syntax.",
        }

    prompt = (
        'Analyze this interpretation transcript and return JSON with keys '
        '"summary", "sentiment", "insights":\n'
        f'{"\\n".join(transcript_list)}'
    )
    raw = _generate(prompt, json_mode=True)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"summary": raw, "sentiment": "Neutral", "insights": ""}


def smart_match_interpreter(
    language_from: str,
    language_to: str,
    profiles: list[dict[str, Any]],
    *,
    service_type: str = "general",
    urgency: str = "immediate",
    sla_level: str = "",
) -> dict[str, Any]:
    interpreters = [p for p in profiles if p.get("role") == "interpreter"]
    qualified = [
        p
        for p in interpreters
        if interpreter_supports_language_pair(p.get("languages"), language_from, language_to)
    ]
    fallback = qualified[0] if qualified else None

    if not is_ai_available():
        matched = fallback
        if not matched:
            return {
                "recommendedInterpreterId": "",
                "reasoning": f"No interpreters registered for {language_from} ⇆ {language_to}.",
            }
        return {
            "recommendedInterpreterId": matched["id"],
            "reasoning": (
                f"Qualified for {language_from} ⇆ {language_to} ({service_type}). "
                f"Rating {matched.get('rating', 5)} with "
                f"{matched.get('completedSessions', 0)} completed sessions."
            ),
        }

    prompt = (
        f"Select the best interpreter for {language_from} -> {language_to}, "
        f"service type {service_type}, urgency {urgency}, SLA {sla_level or 'standard'}.\n"
        f"Qualified interpreters only: {json.dumps(qualified)}\n"
        'Return JSON: {"recommendedInterpreterId": "...", "reasoning": "..."}'
    )
    raw = _generate(prompt, json_mode=True)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {
            "recommendedInterpreterId": fallback["id"] if fallback else "",
            "reasoning": "Fallback match due to AI parse error.",
        }


def orzo_translate(text: str, from_lang: str, to_lang: str) -> dict[str, Any]:
    if not is_ai_available():
        simulated = {
            ("Amharic", "English"): {
                "translatedText": "How are you doing today? Is everything okay with you?",
                "dialect": "Shewa (Addis Ababa) Urban Accent",
                "confidence": 98.4,
                "insights": "Uses polite third-person plural greeting structures.",
                "phoneticGuide": "Indet neh / Indet nesh (m/f)",
            },
            ("English", "Amharic"): {
                "translatedText": "ከባድ ራስ ምታት አለብኝ፤ እባክዎ ይርዱኝ።",
                "dialect": "Standard Literary Amharic",
                "confidence": 96.5,
                "insights": "Proper grammatical conjugation for urgent medical request.",
                "phoneticGuide": "Kebad ras-mitat alebign; ibakwo yirdun",
            },
        }
        return simulated.get(
            (from_lang, to_lang),
            {
                "translatedText": f'[ORZO AI translation of "{text}" from {from_lang} to {to_lang}]',
                "dialect": "Ethiopian Regional Dialect (Standard)",
                "confidence": 95.0,
                "insights": "Excellent fluency in regional linguistic structures.",
                "phoneticGuide": "Pronunciation guidance simulated.",
            },
        )

    prompt = (
        f'You are ORZO AI. Translate from {from_lang} to {to_lang}: "{text}". '
        "Return JSON with translatedText, dialect, confidence, insights, phoneticGuide."
    )
    raw = _generate(prompt, json_mode=True)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"translatedText": raw, "dialect": "", "confidence": 90.0, "insights": "", "phoneticGuide": ""}


def orzo_chat(message: str, context: dict | None = None) -> dict[str, Any]:
    text_lower = message.lower()
    if not is_ai_available():
        if any(w in text_lower for w in ("book", "schedule", "tomorrow", "thursday")):
            return {
                "replyText": "Let me configure a booking slot match for you.",
                "action": "schedule",
                "data": {
                    "language": "Oromo",
                    "sector": "medical",
                    "date": "2026-06-18",
                    "time": "14:00",
                    "duration": 30,
                },
            }
        if any(w in text_lower for w in ("pain", "headache", "translate", "say")):
            return {
                "replyText": "Here are 5 emergency medical phrases with phonetic guides:",
                "action": "phrase",
                "data": {
                    "phrases": [
                        {"phrase": "ራስ ምታት", "meaning": "Severe headache", "phonetic": "Raas muh-taat"},
                        {"phrase": "ደረት ቁስለት", "meaning": "Chest pain", "phonetic": "Deh-ret koos-let"},
                    ]
                },
            }
        return {
            "replyText": "Hello! I am ORZO AI, your language-access agent.",
            "action": "chat",
            "data": {},
        }

    prompt = (
        'You are Orzo AI assistant for Ethiopian interpretation platform. '
        f'User message: "{message}". Context: {json.dumps(context or {})}. '
        'Return JSON: {"replyText": "...", "action": "schedule|phrase|summary|chat", "data": {}}'
    )
    raw = _generate(prompt, json_mode=True)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"replyText": "Connection with Orzo AI confirmed.", "action": "chat", "data": {}}


def ai_interpreter_reply(text: str, from_lang: str, to_lang: str, translated_text: str = "") -> dict[str, str]:
    if not is_ai_available():
        text_lower = text.lower()
        if any(w in text_lower for w in ("hello", "ሰላም", "hi", "እንደምን")):
            return {
                "replyText": "Selam! I am ORZO AI, your dedicated Neural Interpreter.",
                "replyTranslation": "እንደምን ኖት! ለመተርጎም ዝግጁ ነኝ።",
            }
        return {
            "replyText": f"ORZO AI Neural Response: Translated between {from_lang} and {to_lang}.",
            "replyTranslation": f'[Simulated Output in {to_lang}]',
        }

    prompt = (
        f'You are ORZO AI interpreter between {from_lang} and {to_lang}. '
        f'Client said: "{text}" {f"(translation: {translated_text})" if translated_text else ""}. '
        'Return JSON: {"replyText": "...", "replyTranslation": "..."}'
    )
    raw = _generate(prompt, json_mode=True)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"replyText": raw, "replyTranslation": ""}
