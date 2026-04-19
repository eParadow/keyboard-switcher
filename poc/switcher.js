'use strict';

/*
 * PoC — Switcher de layout clavier (étape 2 de la roadmap).
 *
 * Lancement :
 *   node poc/switcher.js
 *
 * Ce que fait le script :
 *   1. Affiche le layout actif au démarrage.
 *   2. Switch vers QWERTY US (00000409), pause 3 s.
 *   3. Switch vers AZERTY BE (0000080C).
 *   4. Affiche le layout actif final.
 *
 * Prérequis :
 *   - Windows 10+ (le module switcher est un stub no-op ailleurs).
 *   - `npm install` effectué (koffi en particulier).
 *   - Les deux layouts suivants doivent être installés sur la machine
 *     (Paramètres → Heure et langue → Langue → Options) :
 *       * Anglais (États-Unis) — 00000409
 *       * Français (Belgique) — 0000080C
 *     Sinon LoadKeyboardLayoutW échoue et le switch n'a aucun effet
 *     visible.
 *   - Avoir une fenêtre active "normale" au premier plan quand le
 *     script tourne (console Windows, Notepad, navigateur...). Si la
 *     seule fenêtre visible est le terminal qui exécute le script,
 *     c'est elle qui reçoit le message — c'est OK pour valider.
 */

const switcher = require('../src/main/switcher.js');

const KLID_US = '00000409';
const KLID_BE = '0000080C';
const DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logResult(label, result) {
  if (result.ok) {
    const suffix = result.skipped ? ' (déjà actif, skip)' : '';
    console.log(`[${label}] OK${suffix}`);
  } else {
    console.log(`[${label}] ECHEC — ${result.error}`);
  }
}

async function main() {
  if (switcher.available === false) {
    console.error(
      `switcher indisponible : ${switcher.unavailableReason || 'raison inconnue'}`
    );
    console.error('Le PoC ne peut tourner que sur Windows avec koffi installé.');
    process.exit(1);
  }

  const initial = switcher.getCurrentLayout();
  console.log(`Layout courant au démarrage : ${initial || '<inconnu>'}`);

  console.log(`Switch vers QWERTY US (${KLID_US})...`);
  logResult('US', switcher.switchLayout(KLID_US));

  const afterUs = switcher.getCurrentLayout();
  console.log(`Layout après switch US : ${afterUs || '<inconnu>'}`);

  console.log(`Pause ${DELAY_MS} ms — tape quelque chose dans une app pour tester.`);
  await sleep(DELAY_MS);

  console.log(`Switch vers AZERTY BE (${KLID_BE})...`);
  logResult('BE', switcher.switchLayout(KLID_BE));

  const final = switcher.getCurrentLayout();
  console.log(`Layout final : ${final || '<inconnu>'}`);
}

main().catch((err) => {
  console.error('Erreur inattendue dans le PoC :', err);
  process.exit(1);
});
