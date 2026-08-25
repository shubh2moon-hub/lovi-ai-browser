/**
 * Hierarchical Multi-Step Planner Agent inspired by Agent-E's high_level_planner_agent.py
 * Decomposes complex user goals into discrete execution sub-tasks and tracks execution progress.
 */

class PlannerAgent {
    constructor() {
        this.activeGoal = null;
        this.steps = [];
        this.currentStepIndex = 0;
        this.isExecutingPlan = false;
    }

    /**
     * Start a new multi-step execution plan
     * @param {string} userGoal - The overall high-level natural language request
     * @param {Array<string>} stepDescriptions - List of sub-task step strings
     */
    createPlan(userGoal, stepDescriptions = []) {
        this.activeGoal = userGoal;
        this.steps = stepDescriptions.map((desc, idx) => ({
            id: idx + 1,
            description: desc,
            status: idx === 0 ? 'in_progress' : 'pending',
            result: null
        }));
        this.currentStepIndex = 0;
        this.isExecutingPlan = this.steps.length > 0;

        return this.getPlanState();
    }

    /**
     * Mark current step complete and move to next
     */
    completeCurrentStep(resultMessage = '') {
        if (!this.isExecutingPlan || this.currentStepIndex >= this.steps.length) {
            return this.getPlanState();
        }

        this.steps[this.currentStepIndex].status = 'completed';
        this.steps[this.currentStepIndex].result = resultMessage;

        this.currentStepIndex++;

        if (this.currentStepIndex < this.steps.length) {
            this.steps[this.currentStepIndex].status = 'in_progress';
        } else {
            this.isExecutingPlan = false;
        }

        return this.getPlanState();
    }

    getCurrentStep() {
        if (!this.isExecutingPlan || this.currentStepIndex >= this.steps.length) {
            return null;
        }
        return this.steps[this.currentStepIndex];
    }

    getPlanState() {
        return {
            goal: this.activeGoal,
            isExecutingPlan: this.isExecutingPlan,
            currentStepIndex: this.currentStepIndex,
            totalSteps: this.steps.length,
            steps: [...this.steps],
            isFinished: !this.isExecutingPlan && this.steps.length > 0 && this.currentStepIndex >= this.steps.length
        };
    }

    reset() {
        this.activeGoal = null;
        this.steps = [];
        this.currentStepIndex = 0;
        this.isExecutingPlan = false;
    }
}

module.exports = PlannerAgent;
