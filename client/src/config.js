// src/config.js — single place for env-driven settings.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';