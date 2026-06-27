"use strict";

// Audio polish smoke suite for Podcast Design Canvas (#15, #197).
// Guards quality presets, per-speaker tracks, control adjustments, processing handoff,
// persistence, and review/export summaries.
// Run with: `node tests/audio-polish.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const audio = require("../app/audio-polish.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function completeUploadDraft() {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera", fileName: "sam.mp4" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.mp4" }),
    Object.assign(setup.createSpeaker("Guest 2"), { name: "Marco Vidal", fileName: "marco.mp4" }),
  ];
  return draft;
}

test("offers Natural, Clean, and Studio quality presets", () => {
  assert.strictEqual(audio.QUALITY_PRESETS.length, 3);
  const ids = audio.QUALITY_PRESETS.map((preset) => preset.id);
  assert.deepStrictEqual(ids, ["natural", "clean", "studio"]);
  audio.QUALITY_PRESETS.forEach((preset) => {
    assert.ok(preset.name && preset.tagline, `${preset.id} is described for creators`);
  });
});

test("createPolish seeds speaker tracks from the episode summary", () => {
  const episode = setup.summarize(completeUploadDraft());
  const polish = audio.createPolish(episode);
  assert.strictEqual(polish.presetId, "clean");
  assert.strictEqual(polish.speakers.length, 3);
  assert.deepStrictEqual(polish.speakers.map((track) => track.role), ["Host", "Guest 1", "Guest 2"]);
  assert.strictEqual(polish.speakers[0].sourceLabel, "sam.mp4");
  assert.strictEqual(polish.speakers[0].status, audio.TRACK_STATUS.PENDING);
});

test("applyPreset updates all polish controls", () => {
  const episode = setup.summarize(completeUploadDraft());
  let polish = audio.createPolish(episode);
  polish = audio.applyPreset(polish, "studio");
  assert.strictEqual(polish.presetId, "studio");
  assert.strictEqual(polish.noiseCleanup, "strong");
  assert.strictEqual(polish.leveling, "strong");
  assert.strictEqual(polish.speechClarity, "strong");
  assert.strictEqual(polish.enhancement, "strong");
});

test("updateControl changes a single polish dimension", () => {
  const episode = setup.summarize(completeUploadDraft());
  let polish = audio.createPolish(episode);
  polish = audio.updateControl(polish, "noiseCleanup", "light");
  assert.strictEqual(polish.noiseCleanup, "light");
  assert.strictEqual(polish.leveling, "balanced");
});

test("applyPolish saves durable polished assets for each imported speaker track", () => {
  const episode = setup.summarize(completeUploadDraft());
  let polish = audio.applyPreset(audio.createPolish(episode), "studio");
  const result = audio.applyPolish(polish, episode);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.polish.processingStatus, "complete");
  assert.strictEqual(result.polish.speakers.length, 3);
  result.polish.speakers.forEach((track) => {
    assert.strictEqual(track.status, audio.TRACK_STATUS.COMPLETE);
    assert.ok(track.polishedAssetId.includes("-studio-polished.wav"));
    assert.ok(track.polishedAssetId.includes("episodes/founders-unfiltered-7/audio/"));
  });
});

test("summarizePolish reflects processing completion and polished track references", () => {
  const episode = setup.summarize(completeUploadDraft());
  const applied = audio.applyPolish(audio.createPolish(episode), episode).polish;
  const summary = audio.summarizePolish(applied);
  assert.strictEqual(summary.presetName, "Clean");
  assert.strictEqual(summary.processingComplete, true);
  assert.strictEqual(summary.usesPolishedAudio, true);
  assert.strictEqual(summary.polishedTracks.length, 3);
  assert.ok(summary.polishedTrackLine.includes("3 polished tracks"));
  assert.ok(summary.audioSourceLine.includes("sam-clean-polished.wav"));
});

test("serializePolish and deserializePolish preserve applied settings and polished tracks", () => {
  const episode = setup.summarize(completeUploadDraft());
  const applied = audio.applyPolish(audio.applyPreset(audio.createPolish(episode), "natural"), episode).polish;
  const restored = audio.deserializePolish(audio.serializePolish(applied), episode);
  const summary = audio.summarizePolish(restored);
  assert.strictEqual(summary.presetName, "Natural");
  assert.strictEqual(summary.processingComplete, true);
  assert.strictEqual(summary.polishedTracks[0].polishedAssetId, applied.speakers[0].polishedAssetId);
});

test("buildReviewSummary includes polished audio in the export path", () => {
  const episode = setup.summarize(completeUploadDraft());
  const polish = audio.summarizePolish(audio.applyPolish(audio.createPolish(episode), episode).polish);
  const review = audio.buildReviewSummary(episode, polish, {
    styleName: "Studio Spotlight",
    templateName: "Founders Unfiltered",
  });
  assert.strictEqual(review.episodeName, "Founders Unfiltered #7");
  assert.strictEqual(review.audioPreset, "Clean");
  assert.strictEqual(review.readyForExport, true);
  assert.strictEqual(review.usesPolishedAudio, true);
  assert.ok(review.summaryLines.some((line) => line.indexOf("Audio:") === 0));
  assert.ok(review.summaryLines.some((line) => line.includes("polished track")));
});

test("ACCEPTANCE: imported episode tracks are processed, persisted, and used downstream", () => {
  const draft = completeUploadDraft();
  assert.strictEqual(setup.validateDraft(draft).ok, true);

  const episode = setup.summarize(draft);
  let polish = audio.createPolish(episode);
  assert.strictEqual(polish.speakers.length, episode.speakerCount);

  polish = audio.applyPreset(polish, "clean");
  polish = audio.updateControl(polish, "speechClarity", "strong");
  const result = audio.applyPolish(polish, episode);
  assert.strictEqual(result.ok, true);

  const applied = audio.summarizePolish(result.polish);
  assert.strictEqual(applied.presetName, "Clean");
  assert.strictEqual(applied.speechClarityLabel, "Strong");
  assert.strictEqual(applied.processingComplete, true);
  assert.strictEqual(applied.polishedTracks.every((track) => Boolean(track.polishedAssetId)), true);

  const restored = audio.deserializePolish(audio.serializePolish(result.polish), episode);
  const restoredSummary = audio.summarizePolish(restored);
  assert.strictEqual(restoredSummary.processingComplete, true);
  assert.strictEqual(restoredSummary.polishedTracks[0].polishedAssetId, applied.polishedTracks[0].polishedAssetId);

  const review = audio.buildReviewSummary(episode, applied, {});
  assert.strictEqual(review.readyForExport, true);
  assert.strictEqual(review.usesPolishedAudio, true);
  assert.ok(review.audioTreatment.includes("Speech clarity: Strong"));
  assert.ok(!review.summaryLines.join(" ").includes("sam.mp4"));
});

console.log(`\naudio polish: ${passed} assertions passed`);
