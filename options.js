document.getElementById('save-button').addEventListener('click', function() {
    const apiKey = document.getElementById('api-key').value;
    const aiModel = document.getElementById('ai-model').value;
    const usageLimit = parseFloat(document.getElementById('usage-limit').value) || 10;
    
    chrome.storage.sync.set({
      apiKey: apiKey,
      aiModel: aiModel,
      usageLimit: usageLimit,
      currentUsage: 0, 
      lastResetDate: new Date().toISOString().slice(0, 7)
    }, function() {
      const status = document.getElementById('status');
      status.textContent = 'Ayarlar kaydedildi.';
      setTimeout(function() {
        status.textContent = '';
      }, 2000);
    });
  });
  
  
  document.addEventListener('DOMContentLoaded', function() {
    chrome.storage.sync.get({
      apiKey: '',
      aiModel: 'gpt-3.5-turbo',
      usageLimit: 10
    }, function(items) {
      document.getElementById('api-key').value = items.apiKey;
      document.getElementById('ai-model').value = items.aiModel;
      document.getElementById('usage-limit').value = items.usageLimit;
    });
  });