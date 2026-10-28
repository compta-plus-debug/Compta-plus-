// ═══ MODULE ═══
// @module Config
// @depends —
// @exports APP_VERSION, ENV_PROD_REF, SUPABASE_ANON_KEY, SUPABASE_URL, useEffect, useMemo, useState
// ═══ FIN DE L'EN-TÊTE ═══
// Version "sans build" : pas d'imports ES module — React, ainsi que les icônes et
// graphiques ci-dessous (remplaçant lucide-react et recharts), sont des variables
// globales chargées directement par <script> dans index.html.
const { useState, useEffect, useMemo } = React;

// --- Supabase (chargé via CDN dans index.html, expose window.supabase.createClient) ---
const SUPABASE_URL = "https://cnmmxpwlgovzbcfqaxqm.supabase.co";
// Version affichée dans le pied de la barre latérale — à incrémenter à chaque
// livraison, en même temps que le cache-buster ?v=... d'index.html, pour pouvoir
// vérifier en un coup d'œil dans l'app elle-même quelle version tourne réellement,
// sans avoir besoin des outils développeur (peu pratiques sur mobile).
const APP_VERSION = "20260830-286";
const SUPABASE_ANON_KEY = "sb_publishable_Ba1KJd2YY-eLaCy1FRECIA_C1DoyAjL";
// K:ENV:START — garde-fou test/production : une copie publiée au mauvais endroit refuse de démarrer
// (références coupées en deux : une recherche de texte dans un fichier ne doit trouver que la base réellement utilisée)
const ENV_PROD_REF = ["cnmmxpwl", "govzbcfqaxqm"].join(""), ENV_TEST_REF = ["lfpqetfas", "jqnucklvwah"].join("");
