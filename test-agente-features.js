const assert = require('assert');
const UserMemory = require('./ai/userMemory');
const LoopDetector = require('./ai/loopDetector');
const PlannerAgent = require('./ai/planner');
const domDistiller = require('./ai/domDistiller');

console.log('====================================================');
console.log('=== 🧪 RUNNING AGENT-E CAPABILITY VERIFICATION ===');
console.log('====================================================\n');

// Test 1: UserMemory LTM & Preferences
console.log('▶ Test 1: UserMemory (Static LTM & Form Filling Mapping)');
const memory = new UserMemory('./tmp-test-data');
assert.strictEqual(typeof memory.getProfile(), 'object');
assert.ok(memory.getProfile().fullName);
assert.strictEqual(memory.findMatchingValueForField('first_name', 'text'), memory.getProfile().firstName);
assert.strictEqual(memory.findMatchingValueForField('email', 'email'), memory.getProfile().email);
assert.strictEqual(memory.findMatchingValueForField('city', 'text'), memory.getProfile().city);
console.log('  ✅ UserMemory correctly retrieves profile and matches form fields!');
console.log('  Summary Context:', memory.getMemorySummary());

// Test 2: LoopDetector
console.log('\n▶ Test 2: LoopDetector (Action Loop Detection & Self-Correction)');
const loopDet = new LoopDetector(10, 3);
assert.strictEqual(loopDet.detectLoop().isLoop, false);

// Record 3 identical actions
loopDet.recordAction({ action: 'click', target: 'id=1', url: 'https://example.com' });
loopDet.recordAction({ action: 'click', target: 'id=1', url: 'https://example.com' });
const loopRes = loopDet.recordAction({ action: 'click', target: 'id=1', url: 'https://example.com' });

assert.strictEqual(loopRes.isLoop, true);
assert.ok(loopRes.reason.includes('Repeated action'));
console.log('  ✅ LoopDetector detected repeating action loop!');
console.log('  Reason:', loopRes.reason);
console.log('  Suggested Correction:', loopRes.suggestedCorrection);

// Test 3: PlannerAgent
console.log('\n▶ Test 3: Hierarchical PlannerAgent (Task Decomposition)');
const planner = new PlannerAgent();
const plan = planner.createPlan('Buy dishwasher detergent on Amazon', [
    'Navigate to Amazon',
    'Search for Finish dishwasher detergent',
    'Sort search results by best seller',
    'Select first product',
    'Add product to cart'
]);

assert.strictEqual(plan.totalSteps, 5);
assert.strictEqual(plan.currentStepIndex, 0);
assert.strictEqual(planner.getCurrentStep().description, 'Navigate to Amazon');

// Complete step 1 & step 2
planner.completeCurrentStep('Navigated to amazon.com');
planner.completeCurrentStep('Searched for detergent');

const updatedPlan = planner.getPlanState();
assert.strictEqual(updatedPlan.currentStepIndex, 2);
assert.strictEqual(updatedPlan.steps[0].status, 'completed');
assert.strictEqual(updatedPlan.steps[1].status, 'completed');
assert.strictEqual(updatedPlan.steps[2].status, 'in_progress');
console.log('  ✅ PlannerAgent correctly tracks multi-step task execution progress!');

// Test 4: DOMDistiller Scripts
console.log('\n▶ Test 4: DOMDistiller (Element Indexing & Scripts)');
assert.ok(domDistiller.DOM_DISTILL_SCRIPT.includes('data-lovi-id'));
assert.ok(domDistiller.CLICK_ELEMENT_SCRIPT('2').includes('[data-lovi-id="2"]'));
assert.ok(domDistiller.TYPE_ELEMENT_SCRIPT('0', 'test').includes('value = "test"'));
console.log('  ✅ DOMDistiller scripts generated correctly!');

console.log('\n====================================================');
console.log('=== 🎉 ALL AGENT-E UNIT & INTEGRATION TESTS PASSED! ===');
console.log('====================================================\n');
