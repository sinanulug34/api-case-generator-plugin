document.addEventListener('DOMContentLoaded', function() {
  const curlInput = document.getElementById('curl-input');
  const parsedOutput = document.getElementById('parsed-output');
  const testsOutput = document.getElementById('tests-output');
  const karateOutput = document.getElementById('karate-output');
  
  const analyzeButton = document.getElementById('analyze-button');
  const generateButton = document.getElementById('generate-button');
  const copyButton = document.getElementById('copy-button');
  const clearButton = document.getElementById('clear-button');
  const aiAnalyzeButton = document.getElementById('ai-analyze-button');
  const loadingIndicator = document.getElementById('loading-indicator');
  const apiKeyMissing = document.getElementById('api-key-missing');
  
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabPanes = document.querySelectorAll('.tab-pane');
  
  let currentTab = 'parsed';
  let parsedRequest = null;

  chrome.storage.local.clear(function() {
    curlInput.value = '';
    parsedOutput.textContent = '';
    testsOutput.textContent = '';
    karateOutput.textContent = '';
    hideBodyFields();
  });

  chrome.storage.sync.get({
    apiKey: ''
  }, function(items) {
    if (!items.apiKey) {
      apiKeyMissing.style.display = 'block';
    } else {
      apiKeyMissing.style.display = 'none';
    }
  });
  
  document.getElementById('open-options').addEventListener('click', function(e) {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  tabButtons.forEach(button => {
    button.addEventListener('click', function() {
      const tabId = this.getAttribute('data-tab');
      
      tabButtons.forEach(btn => btn.classList.remove('active'));
      this.classList.add('active');
      
      tabPanes.forEach(pane => pane.classList.remove('active'));
      document.getElementById(`${tabId}-tab`).classList.add('active');
      
      currentTab = tabId;
    });
  });

  function parseCurl(curlCommand) {
    try {
      let cmd = curlCommand.replace(/\\s*\\\\s*/g, ' ').trim();
      
      const methodMatch = cmd.match(/-X\s+['"]?([A-Z]+)['"]?/i);
      const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
      
      const urlMatch = cmd.match(/curl\s+(?:-X\s+['"]?[A-Z]+['"]?\s+)?['"]?([^"'\s]+)['"]?/);
      const url = urlMatch ? urlMatch[1] : '';
      
      const headers = {};
      const headerMatches = cmd.matchAll(/-H\s+['"]([^:]+):\s*([^'"]+)['"]?/g);
      for (const match of headerMatches) {
        headers[match[1].trim()] = match[2].trim();
      }
      
      const bodyMatch = cmd.match(/-d\s+['"](.+?)['"](?:\s+|$)/s);
      let body = null;
      if (bodyMatch) {
        try {
          body = JSON.parse(bodyMatch[1].replace(/\\\\"/g, '"'));
        } catch (e) {
          body = bodyMatch[1];
        }
      }
      
      if (body && typeof body === 'object') {
        displayBodyFields(body);
      } else {
        hideBodyFields();
      }
      
      return {
        method,
        url,
        headers,
        body
      };
    } catch (error) {
      hideBodyFields();
      return {
        error: `Analiz hatası: ${error.message}`
      };
    }
  }
  
  function displayBodyFields(body) {
    const fieldsContainer = document.querySelector('.required-fields-container');
    const fieldsList = document.getElementById('required-fields-list');
    
    fieldsList.innerHTML = '';
    
    Object.entries(body).forEach(([fieldName, fieldValue]) => {
      const fieldRow = document.createElement('div');
      fieldRow.className = 'field-row';
      fieldRow.setAttribute('data-field-name', fieldName);
      fieldRow.setAttribute('data-required', 'false');
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'field-name';
      nameSpan.textContent = fieldName;
      
      const typeSpan = document.createElement('span');
      typeSpan.className = 'field-type';
      typeSpan.textContent = typeof fieldValue;
      
      const requiredLabel = document.createElement('label');
      requiredLabel.className = 'field-required';
      requiredLabel.innerHTML = '<input type="checkbox" class="required-checkbox"> Zorunlu';
      
      const requiredCheckbox = requiredLabel.querySelector('input');
      requiredCheckbox.addEventListener('change', function() {
        fieldRow.setAttribute('data-required', this.checked);
      });
      
      fieldRow.appendChild(nameSpan);
      fieldRow.appendChild(typeSpan);
      fieldRow.appendChild(requiredLabel);
      
      fieldsList.appendChild(fieldRow);
    });
    
    fieldsContainer.style.display = 'block';
  }
  
  function hideBodyFields() {
    const fieldsContainer = document.querySelector('.required-fields-container');
    fieldsContainer.style.display = 'none';
  }

  async function trackOpenAIUsage(tokenCount) {
    return new Promise((resolve) => {
      const currentMonth = new Date().toISOString().slice(0, 7); 
      
      chrome.storage.sync.get({
        currentUsage: 0,
        usageLimit: 10,
        lastResetDate: ''
      }, function(items) {
        let { currentUsage, lastResetDate } = items;
        const usageLimit = items.usageLimit;
        
        if (lastResetDate !== currentMonth) {
          currentUsage = 0;
          lastResetDate = currentMonth;
        }

        const estimatedCost = tokenCount * 0.000002;
        
        currentUsage += estimatedCost;
        
        chrome.storage.sync.set({
          currentUsage,
          lastResetDate
        });
        
        if (currentUsage > usageLimit) {
          resolve({
            limitExceeded: true,
            currentUsage,
            usageLimit
          });
        } else {
          resolve({
            limitExceeded: false,
            currentUsage,
            usageLimit
          });
        }
      });
    });
  }

  async function generateWithOpenAI(parsedRequest) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get({
        apiKey: '',
        aiModel: 'gpt-3.5-turbo'
      }, async function(items) {
        if (!items.apiKey) {
          resolve({
            error: 'API anahtarı bulunamadı',
            errorType: 'api_key_missing'
          });
          return;
        }
        
        try {
          const { method, url, headers, body } = parsedRequest;
          
          let baseUrl = '';
          let path = '';
          
          try {
            const urlObj = new URL(url);
            baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
            if (urlObj.port) baseUrl += `:${urlObj.port}`;
            path = urlObj.pathname + urlObj.search;
          } catch (e) {
            baseUrl = 'https://example.com';
            path = url;
          }
          
          let endpointName = path.split('/').filter(Boolean).pop() || 'api';
          if (endpointName.includes('?')) endpointName = endpointName.split('?')[0];
          
          const prompt = `
Lütfen aşağıdaki API isteği için Karate DSL formatında test senaryoları oluştur.

API İsteği Detayları:
- HTTP Metodu: ${method}
- Endpoint: ${path}
- Base URL: ${baseUrl}
- Headers: ${JSON.stringify(headers, null, 2)}
${body ? `- Request Body: ${JSON.stringify(body, null, 2)}` : ''}

Bu Karate DSL test dosyası şunları içermeli:
1. Feature tanımı ve Background bölümü (URL ve request payload tanımlama)
2. Başarılı istek senaryosu (status kodu ve yanıt formatı kontrolü)
3. Request body'deki her alan için geçersiz format senaryoları (string yerine number veya tersi)
4. Request body'deki alanlarda eksik alan senaryoları
${headers['Authorization'] ? '5. Geçersiz token ile yetkilendirme hatası senaryosu' : ''}
${(method === 'GET' || method === 'PUT' || method === 'DELETE') ? '6. Olmayan kaynak (404) senaryosu' : ''}

Her senaryoda aşağıdaki assertion'ları kullan:
- Durum kodu kontrolü
- Yanıt içeriğinin kontrolü (error mesajları, eksik/geçersiz alanlar)
- Yanıt formatı kontrolü

Lütfen sadece Karate DSL kodunu ver, açıklama ekleme.
`;

          const inputTokens = prompt.length / 4; 
          const outputTokens = 1500; 

          const usageCheck = await trackOpenAIUsage(inputTokens + outputTokens);
          if (usageCheck.limitExceeded) {
            resolve({
              error: `AI kullanım limitiniz aşıldı (${usageCheck.currentUsage.toFixed(2)}$/${usageCheck.usageLimit}$)`,
              errorType: 'usage_limit_exceeded'
            });
            return;
          }

          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${items.apiKey}`
            },
            body: JSON.stringify({
              model: items.aiModel,
              messages: [
                { 
                  role: "system", 
                  content: "Sen bir API test uzmanısın. Verilen bir API isteği için Karate DSL kullanarak kapsamlı test senaryoları üretirsin." 
                },
                { role: "user", content: prompt }
              ],
              temperature: 0.7,
              max_tokens: 2000
            })
          });

          const data = await response.json();
          
          if (data.error) {
            resolve({
              error: `OpenAI API hatası: ${data.error.message}`,
              errorType: 'openai_api_error'
            });
            return;
          }
          
          const aiResponse = data.choices[0].message.content.trim();
          
          resolve({
            karateDSL: aiResponse,
            usageStats: {
              cost: ((inputTokens + outputTokens) * 0.000002).toFixed(5),
              currentMonthUsage: usageCheck.currentUsage.toFixed(2)
            }
          });
          
        } catch (error) {
          resolve({
            error: `İstek hatası: ${error.message}`,
            errorType: 'request_error'
          });
        }
      });
    });
  }

  function generateTestScenarios(parsedRequest) {
    if (!parsedRequest || parsedRequest.error) return '';
    
    let scenarios = [];
    const { method, url, headers, body } = parsedRequest;
    
    scenarios.push({
      description: '1. Başarılı istek senaryosu',
      method,
      url,
      headers,
      body,
      expected: {
        status: method === 'POST' || method === 'PUT' ? 201 : 200,
        desc: 'İstek başarıyla tamamlanmalı ve geçerli bir yanıt dönmeli'
      }
    });
    
    if (headers['Authorization']) {
      scenarios.push({
        description: '2. Geçersiz kimlik doğrulama senaryosu',
        method,
        url,
        headers: { ...headers, 'Authorization': 'Bearer invalid_token' },
        body,
        expected: {
          status: 401,
          desc: 'Geçersiz kimlik bilgileriyle yetkilendirme hatası alınmalı'
        }
      });
    }
    
    if (headers['Content-Type']) {
      const newHeaders = { ...headers };
      delete newHeaders['Content-Type'];
      
      scenarios.push({
        description: '3. Content-Type header eksik senaryosu',
        method,
        url,
        headers: newHeaders,
        body,
        expected: {
          status: 400,
          desc: 'Content-Type header eksikken hata alınmalı'
        }
      });
    }
    
    if (body && typeof body === 'object') {
      const requiredFields = document.querySelectorAll('.field-row[data-required="true"]');
      const requiredFieldNames = Array.from(requiredFields).map(el => el.getAttribute('data-field-name'));
      
      Object.keys(body).forEach((key, index) => {
        const originalValue = body[key];
        let invalidValue;
        let invalidDesc;
        
        if (typeof originalValue === 'number') {
          invalidValue = 'not_a_number';
          invalidDesc = 'sayısal değer yerine string';
        } else if (typeof originalValue === 'string') {
          if (key.toLowerCase().includes('email')) {
            invalidValue = 'invalid_email';
            invalidDesc = 'geçersiz email formatı';
          } else {
            invalidValue = originalValue === '' ? 123 : '';
            invalidDesc = originalValue === '' ? 'boş string yerine sayı' : 'string yerine boş string';
          }
        } else if (typeof originalValue === 'boolean') {
          invalidValue = 'not_boolean';
          invalidDesc = 'boolean yerine string';
        }
        
        const invalidBody = { ...body };
        invalidBody[key] = invalidValue;
        
        scenarios.push({
          description: `${4 + index}. Geçersiz ${key} alanı senaryosu (${invalidDesc})`,
          method,
          url,
          headers,
          body: invalidBody,
          expected: {
            status: 400,
            desc: `${key} alanında geçersiz veri türü/format olduğunda hata alınmalı`
          }
        });
      });
      
      requiredFieldNames.forEach((fieldName, index) => {
        if (Object.keys(body).includes(fieldName)) {
          const missingFieldBody = { ...body };
          delete missingFieldBody[fieldName];
          
          scenarios.push({
            description: `${4 + Object.keys(body).length + index}. Zorunlu ${fieldName} alanı eksik senaryosu`,
            method,
            url,
            headers,
            body: missingFieldBody,
            expected: {
              status: 400,
              desc: `Zorunlu ${fieldName} alanı eksik olduğunda hata alınmalı`
            }
          });
        }
      });
      
      if (requiredFieldNames.length === 0 && Object.keys(body).length > 0) {
        const firstField = Object.keys(body)[0];
        const missingFieldBody = { ...body };
        delete missingFieldBody[firstField];
        
        scenarios.push({
          description: `${4 + Object.keys(body).length}. Zorunlu ${firstField} alanı eksik senaryosu`,
          method,
          url,
          headers,
          body: missingFieldBody,
          expected: {
            status: 400,
            desc: `Zorunlu ${firstField} alanı eksik olduğunda hata alınmalı`
          }
        });
      }
    }
    
    if (url.includes('?') && url.includes('=')) {
      const urlParts = url.split('?');
      
      scenarios.push({
        description: `${4 + Object.keys(body || {}).length + 1}. Eksik URL parametresi senaryosu`,
        method,
        url: urlParts[0],
        headers,
        body,
        expected: {
          status: 400,
          desc: 'Gerekli URL parametreleri eksikken hata alınmalı'
        }
      });
    }
    
    return formatTestScenarios(scenarios);
  }
  
  function formatTestScenarios(scenarios) {
    let result = `# API Test Senaryoları\n\n`;
    
    scenarios.forEach(scenario => {
      result += `## ${scenario.description}\n\n`;
      result += `- HTTP Metodu: ${scenario.method}\n`;
      result += `- URL: ${scenario.url}\n`;
      
      if (Object.keys(scenario.headers).length > 0) {
        result += `- Headers:\n`;
        for (const [key, value] of Object.entries(scenario.headers)) {
          result += `  - ${key}: ${value}\n`;
        }
      }
      
      if (scenario.body) {
        result += `- Request Body:\n\`\`\`json\n${JSON.stringify(scenario.body, null, 2)}\n\`\`\`\n`;
      }
      
      result += `- Beklenen Sonuç:\n`;
      result += `  - Status: ${scenario.expected.status}\n`;
      result += `  - Açıklama: ${scenario.expected.desc}\n\n`;
    });
    
    return result;
  }
  
  function generateKarateDSL(parsedRequest) {
    if (!parsedRequest || parsedRequest.error) return '';
    
    const { method, url, headers, body } = parsedRequest;
    
    let baseUrl = '';
    let path = '';
    
    try {
      const urlObj = new URL(url);
      baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
      if (urlObj.port) baseUrl += `:${urlObj.port}`;
      path = urlObj.pathname + urlObj.search;
    } catch (e) {
      baseUrl = 'https://example.com';
      path = url;
    }
    
    let endpointName = path.split('/').filter(Boolean).pop() || 'api';
    if (endpointName.includes('?')) endpointName = endpointName.split('?')[0];
    
    let karateDSL = `# Karate DSL Test Script
Feature: Test ${endpointName} endpoint

  Background:
    * url '${baseUrl}'
    * def requestPayload = ${body ? JSON.stringify(body, null, 4) : '{}'}
`;

    if (Object.keys(headers).length > 0) {
      karateDSL += `    * headers {`;
      for (const [key, value] of Object.entries(headers)) {
        karateDSL += `\n      ${key}: '${value.replace(/'/g, "\\'")}'`;
      }
      karateDSL += `\n    }\n`;
    }
    
    karateDSL += `
  Scenario: ${method} isteği başarılı olmalı
    Given path '${path}'
    And request requestPayload
    When method ${method}
    Then status ${method === 'POST' || method === 'PUT' ? 201 : 200}
    And match response != null`;
  
    if (method === 'POST') {
      karateDSL += `
    # POST Assertion'ları
    And match response.id == '#present'
    And match response.createdAt == '#present'`;
      
      if (body && typeof body === 'object') {
        Object.keys(body).forEach(key => {
          karateDSL += `
    And match response.${key} == requestPayload.${key}`;
        });
      }
    } 
    else if (method === 'GET') {
      karateDSL += `
    # GET Assertion'ları
    And match response == '#notnull'
    And match response == '#array' || match response == '#object'`;
    }
    else if (method === 'PUT' || method === 'PATCH') {
      karateDSL += `
    # UPDATE Assertion'ları
    And match response.updatedAt == '#present'`;
      
      if (body && typeof body === 'object') {
        Object.keys(body).forEach(key => {
          karateDSL += `
    And match response.${key} == requestPayload.${key}`;
        });
      }
    }
    else if (method === 'DELETE') {
      karateDSL += `
    # DELETE Assertion'ları
    And match response == '#notnull'`;
    }
    
    karateDSL += `\n`;

    if (body && typeof body === 'object') {
      Object.keys(body).forEach((key, index) => {
        const originalValue = body[key];
        let invalidValue;
        
        if (typeof originalValue === 'number') {
          invalidValue = '"not_a_number"';
        } else if (typeof originalValue === 'string') {
          if (key.toLowerCase().includes('email')) {
            invalidValue = '"invalid_email"';
          } else {
            invalidValue = originalValue === '' ? '123' : '""';
          }
        } else if (typeof originalValue === 'boolean') {
          invalidValue = '"not_boolean"';
        } else {
          invalidValue = '""';
        }
        
        karateDSL += `
  Scenario: ${method} isteği geçersiz ${key} alanı ile başarısız olmalı
    Given path '${path}'
    And def invalidPayload = requestPayload
    And set invalidPayload.${key} = ${invalidValue}
    And request invalidPayload
    When method ${method}
    Then status 400
    # Assertion'lar
    And match response.error == '#present'
    And match response.message == '#present'
    And match response.errors[*].field contains '${key}'
`;
      });
      
      const requiredFields = document.querySelectorAll('.field-row[data-required="true"]');
      const requiredFieldNames = Array.from(requiredFields).map(el => el.getAttribute('data-field-name'));
      
      if (requiredFieldNames.length > 0) {
        requiredFieldNames.forEach(fieldName => {
          if (Object.keys(body).includes(fieldName)) {
            karateDSL += `
  Scenario: ${method} isteği eksik ${fieldName} alanı ile başarısız olmalı
    Given path '${path}'
    And def invalidPayload = requestPayload
    And remove invalidPayload.${fieldName}
    And request invalidPayload
    When method ${method}
    Then status 400
    # Assertion'lar
    And match response.error == '#present'
    And match response.message == '#present'
    And match response.errors[*].field contains '${fieldName}'
    And match response..message contains 'required'
`;
          }
        });
      } else if (Object.keys(body).length > 0) {
        const firstField = Object.keys(body)[0];
        
        karateDSL += `
  Scenario: ${method} isteği eksik ${firstField} alanı ile başarısız olmalı
    Given path '${path}'
    And def invalidPayload = requestPayload
    And remove invalidPayload.${firstField}
    And request invalidPayload
    When method ${method}
    Then status 400
    # Assertion'lar
    And match response.error == '#present'
    And match response.message contains '${firstField}'
`;
      }
    }
    
    if (headers['Authorization']) {
      karateDSL += `
  Scenario: ${method} isteği geçersiz token ile başarısız olmalı
    Given path '${path}'
    And request requestPayload
    And header Authorization = 'Bearer invalid_token'
    When method ${method}
    Then status 401
    # Assertion'lar
    And match response.error == '#present'
    And match response.message contains 'authentication'
`;
    }
    
    if (method === 'GET' || method === 'PUT' || method === 'DELETE') {
      const pathParts = path.split('/');
      let lastSegment = pathParts[pathParts.length - 1];
      
      if (/^\d+$/.test(lastSegment) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lastSegment)) {
        karateDSL += `
  Scenario: ${method} isteği olmayan kaynağı çağırdığında başarısız olmalı
    Given path '${path.replace(lastSegment, "999999999")}'
    And request requestPayload
    When method ${method}
    Then status 404
    # Assertion'lar
    And match response.error == '#present'
    And match response.message contains 'not found'
`;
      }
    }
    
    return karateDSL;
  }

  analyzeButton.addEventListener('click', function() {
    const curlCommand = curlInput.value.trim();
    
    if (!curlCommand) {
      parsedOutput.textContent = 'Lütfen bir CURL komutu girin.';
      testsOutput.textContent = '';
      karateOutput.textContent = '';
      generateButton.disabled = true;
      return;
    }
    
    parsedRequest = parseCurl(curlCommand);
    
    parsedOutput.textContent = JSON.stringify(parsedRequest, null, 2);
    
    if (parsedRequest && !parsedRequest.error && parsedRequest.body && typeof parsedRequest.body === 'object') {
      generateButton.disabled = false;
    } else {
      generateButton.disabled = true;
      
      if (!parsedRequest.error) {
        testsOutput.textContent = generateTestScenarios(parsedRequest);
        karateOutput.textContent = generateKarateDSL(parsedRequest);
      } else {
        testsOutput.textContent = 'CURL komutunun analizi sırasında bir hata oluştu.';
        karateOutput.textContent = 'CURL komutunun analizi sırasında bir hata oluştu.';
      }
    }
  });
  
  generateButton.addEventListener('click', function() {
    if (parsedRequest && !parsedRequest.error) {
      testsOutput.textContent = generateTestScenarios(parsedRequest);
      karateOutput.textContent = generateKarateDSL(parsedRequest);
      
      tabButtons.forEach(btn => {
        if (btn.getAttribute('data-tab') === 'karate') {
          btn.click();
        }
      });
    }
  });
  
  aiAnalyzeButton.addEventListener('click', async function() {
    const curlCommand = curlInput.value.trim();
    
    if (!curlCommand) {
      parsedOutput.textContent = 'Lütfen bir CURL komutu girin.';
      testsOutput.textContent = '';
      karateOutput.textContent = '';
      return;
    }
    
    chrome.storage.sync.get({
      apiKey: ''
    }, async function(items) {
      if (!items.apiKey) {
        apiKeyMissing.style.display = 'block';
        karateOutput.textContent = 'AI analizi için OpenAI API anahtarı gereklidir. Ayarlar sayfasından API anahtarınızı ekleyebilirsiniz.';
        tabButtons.forEach(btn => {
          if (btn.getAttribute('data-tab') === 'karate') {
            btn.click();
          }
        });
        return;
      }
      
      loadingIndicator.style.display = 'flex';
      aiAnalyzeButton.disabled = true;
      
      parsedRequest = parseCurl(curlCommand);
      
      parsedOutput.textContent = JSON.stringify(parsedRequest, null, 2);
      
      if (!parsedRequest.error) {
        const openAIResult = await generateWithOpenAI(parsedRequest);
        
        if (openAIResult.error) {
          if (openAIResult.errorType === 'api_key_missing') {
            apiKeyMissing.style.display = 'block';
            karateOutput.textContent = 'AI analizi için OpenAI API anahtarı gereklidir. Ayarlar sayfasından API anahtarınızı ekleyebilirsiniz.';
          } else if (openAIResult.errorType === 'usage_limit_exceeded') {
            karateOutput.textContent = openAIResult.error + '\n\nKullanım limitinizi Ayarlar sayfasından artırabilirsiniz.';
          } else {
            karateOutput.textContent = openAIResult.error;
          }
        } else {
          karateOutput.textContent = openAIResult.karateDSL;
          
          karateOutput.textContent += `\n\n# AI Kullanım İstatistikleri\n# Yaklaşık Maliyet: $${openAIResult.usageStats.cost}\n# Bu Ayki Toplam: $${openAIResult.usageStats.currentMonthUsage}`;
          
          testsOutput.textContent = generateTestScenarios(parsedRequest);
        }
        
        tabButtons.forEach(btn => {
          if (btn.getAttribute('data-tab') === 'karate') {
            btn.click();
          }
        });
      } else {
        testsOutput.textContent = 'CURL komutunun analizi sırasında bir hata oluştu.';
        karateOutput.textContent = 'CURL komutunun analizi sırasında bir hata oluştu.';
      }
      
      loadingIndicator.style.display = 'none';
      aiAnalyzeButton.disabled = false;
    });
  });

  copyButton.addEventListener('click', function() {
    let contentToCopy = '';
    
    if (currentTab === 'parsed') {
      contentToCopy = parsedOutput.textContent;
    } else if (currentTab === 'tests') {
      contentToCopy = testsOutput.textContent;
    } else if (currentTab === 'karate') {
      contentToCopy = karateOutput.textContent;
    }
    
    if (contentToCopy) {
      navigator.clipboard.writeText(contentToCopy)
        .then(() => {
          copyButton.textContent = 'Kopyalandı!';
          setTimeout(() => {
            copyButton.textContent = 'Kopyala';
          }, 2000);
        })
        .catch(err => {
          console.error('Kopyalama hatası:', err);
        });
    }
  });

  clearButton.addEventListener('click', function() {
    curlInput.value = '';
    parsedOutput.textContent = '';
    testsOutput.textContent = '';
    karateOutput.textContent = '';
    parsedRequest = null;
    hideBodyFields();
    generateButton.disabled = true;
  });
  
  curlInput.addEventListener('input', function() {
    chrome.storage.local.set({curlInput: curlInput.value});
  });
});
      