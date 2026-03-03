document.addEventListener("DOMContentLoaded", function () {
    const userInput = document.getElementById('user-input');
    const addButton = document.getElementById('btn-add');
    const historyContent = document.getElementById('chat-history-content');

    const notificationEl = document.getElementById('chat-notification');
    const notificationTextEl = document.getElementById('chat-notification-text');

    function showNotification(text) {
        if (notificationEl && notificationTextEl) {
            notificationTextEl.textContent = text;
            notificationEl.style.display = 'block';
        }
    }

    function hideNotification() {
        if (notificationEl) {
            notificationEl.style.display = 'none';
        }
    }

    function addMessageToHistory(text, isUser = true) {
        const msgDiv = document.createElement('div');
        msgDiv.className = isUser ? 'chat-message user' : 'chat-message';
        msgDiv.textContent = text;
        historyContent.appendChild(msgDiv);
        setTimeout(() => {
            historyContent.parentElement.scrollTop = historyContent.parentElement.scrollHeight;
        }, 0);
    }

    // Convert simple spec to engine commands
    function convertSpecToCommands(spec) {
        const commands = [];
        const typeToAction = {
            'wall': 'addWall',
            'cylinder': 'addCylinder',
            'cube': 'addCube',
            'triangle': 'addTriangle',
            'sphere': 'addSphere',
            'cone': 'addCone',
            'torus': 'addTorus',
            'box': 'addBox',
            'capsule': 'addCapsule'
        };
        
        const action = typeToAction[spec.type];
        if (action) {
            commands.push({
                action: action,
                params: spec
            });
        }
        
        return commands;
    }

    async function sendMessage() {
        if (!userInput) return;
        const message = userInput.value;
        if (message.trim()) {
            addMessageToHistory(message, true);
            userInput.value = '';
            
            showNotification('Processing request...');
            
            try {
                const resp = await fetch('/api/interpret', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: message }),
                });
                
                const data = await resp.json();
                
                if (!resp.ok || !data.ok) {
                    const errorMsg = data.error || 'Failed to generate 3D object';
                    showNotification(`❌ ${errorMsg}`);
                    addMessageToHistory(`Error: ${errorMsg}. Try again.`, false);
                    setTimeout(hideNotification, 3000);
                    return;
                }

                // Handle the spec from server
                if (window.engine && data.spec) {
                    const spec = data.spec;
                    const meta = spec._learningMeta;
                    
                    // If it has a composition, add as composite object
                    if (spec.composition && Array.isArray(spec.composition)) {
                        window.engine.addComposite({
                            composition: spec.composition,
                            x: 0,
                            z: 0,
                            name: spec.type || 'object'
                        });
                        
                        // Show improvement info
                        let message = `✓ ${spec.type || 'Object'} created with ${spec.composition.length} parts`;
                        if (meta) {
                            if (meta.isImprovement) {
                                message += ` 📈 (v${meta.iteration} - improved!)`;
                            } else {
                                message += ` 🆕 (v${meta.iteration})`;
                            }
                        }
                        showNotification(message);
                    } else {
                        // Single primitive object
                        const commands = convertSpecToCommands(spec);
                        if (commands.length > 0) {
                            window.engine.executeCommands(commands);
                            showNotification(`✓ ${spec.type || 'Object'} created`);
                        }
                    }
                    
                    setTimeout(hideNotification, 2000);
                } else {
                    hideNotification();
                }
            } catch (e) {
                console.error('failed interpret', e);
                showNotification('❌ Server connection error');
                addMessageToHistory('Error processing request. Check your server connection.', false);
                setTimeout(hideNotification, 3000);
            }
        }
    }

    // send on enter/return
    userInput?.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === 'Return') {
            e.preventDefault();
            sendMessage();
        }
    });

    addButton?.addEventListener('click', () => {
        sendMessage();
    });

    // Feedback panel event listeners
    const feedbackPanel = document.getElementById('feedback-panel');
    const feedbackInput = document.getElementById('feedback-input');
    const submitFeedbackBtn = document.getElementById('btn-submit-feedback');
    const cancelFeedbackBtn = document.getElementById('btn-cancel-feedback');

    // Submit feedback
    submitFeedbackBtn?.addEventListener('click', () => {
        const feedback = feedbackInput?.value.trim();
        if (feedback && window.engine) {
            window.engine.submitFeedback(feedback);
        }
    });

    // Submit on Enter
    feedbackInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const feedback = feedbackInput.value.trim();
            if (feedback && window.engine) {
                window.engine.submitFeedback(feedback);
            }
        }
    });

    // Cancel/close feedback panel
    cancelFeedbackBtn?.addEventListener('click', () => {
        if (feedbackPanel) {
            feedbackPanel.style.display = 'none';
        }
    });
});