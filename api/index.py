"""Vercel Python entry point.

Exposes the FastAPI app as a Vercel Serverless Function.
Vercel routes /api/* to this file.

The FastAPI app is created from backend/app/main.py.
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.main import create_app

app = create_app()
