const fs = require('fs');
const path = require('path');

class UserMemory {
    constructor(storageDir) {
        this.storageDir = storageDir || path.join(__dirname, '..', 'data');
        this.filePath = path.join(this.storageDir, 'user-memory.json');
        this.memory = this._loadMemory();
    }

    _loadMemory() {
        try {
            if (!fs.existsSync(this.storageDir)) {
                fs.mkdirSync(this.storageDir, { recursive: true });
            }
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (err) {
            console.error('[UserMemory] Error loading memory file:', err);
        }
        
        // Default initial profile template (Agent-E user preferences model)
        const defaultMemory = {
            profile: {
                fullName: 'Shubh',
                firstName: 'Shubh',
                lastName: 'User',
                email: 'shubh@example.com',
                phone: '+1-555-0199',
                address: '123 Tech Lane',
                city: 'San Francisco',
                state: 'CA',
                zipCode: '94105',
                country: 'USA'
            },
            preferences: {
                searchEngine: 'DuckDuckGo',
                favoriteGenre: 'Sci-Fi / Nolan',
                ticketClass: 'Business',
                autoFillConsent: true
            },
            customNotes: {}
        };

        this._saveMemory(defaultMemory);
        return defaultMemory;
    }

    _saveMemory(data) {
        try {
            if (!fs.existsSync(this.storageDir)) {
                fs.mkdirSync(this.storageDir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(data || this.memory, null, 2), 'utf8');
        } catch (err) {
            console.error('[UserMemory] Error saving memory file:', err);
        }
    }

    getProfile() {
        return this.memory.profile || {};
    }

    getPreferences() {
        return this.memory.preferences || {};
    }

    updateProfile(updates) {
        this.memory.profile = { ...this.memory.profile, ...updates };
        this._saveMemory();
        return this.memory.profile;
    }

    setPreference(key, value) {
        this.memory.preferences[key] = value;
        this._saveMemory();
    }

    /**
     * Map web form field names/types to user memory values (Agent-E style form filling LTM)
     */
    findMatchingValueForField(fieldName = '', fieldType = '', placeholder = '') {
        const query = `${fieldName} ${placeholder} ${fieldType}`.toLowerCase();
        const profile = this.memory.profile;

        if (query.includes('first name') || query.includes('fname') || query.includes('given name')) {
            return profile.firstName;
        }
        if (query.includes('last name') || query.includes('lname') || query.includes('surname')) {
            return profile.lastName;
        }
        if (query.includes('full name') || query.includes('name')) {
            return profile.fullName;
        }
        if (query.includes('email') || query.includes('e-mail') || fieldType === 'email') {
            return profile.email;
        }
        if (query.includes('phone') || query.includes('mobile') || query.includes('tel') || fieldType === 'tel') {
            return profile.phone;
        }
        if (query.includes('address') || query.includes('street')) {
            return profile.address;
        }
        if (query.includes('city') || query.includes('town')) {
            return profile.city;
        }
        if (query.includes('zip') || query.includes('postal') || query.includes('pincode')) {
            return profile.zipCode;
        }
        if (query.includes('country')) {
            return profile.country;
        }
        return null;
    }

    /**
     * Summary of user context for LLM prompt context
     */
    getMemorySummary() {
        const p = this.memory.profile;
        const prefs = this.memory.preferences;
        return `User Name: ${p.fullName || 'User'}, Email: ${p.email || 'N/A'}, City: ${p.city || 'N/A'}, Country: ${p.country || 'N/A'}. Preferred Search: ${prefs.searchEngine || 'DuckDuckGo'}.`;
    }
}

module.exports = UserMemory;
