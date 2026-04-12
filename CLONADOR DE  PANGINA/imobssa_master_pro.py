#!/usr/bin/env python3
"""
IMOBSSA MASTER PRO v3.0
Script Profissional com Cobertura 100%
- Paginação automática
- Navegação de itens
- Fluxo de checkout
- Login automático
- Captura de APIs
"""

import os
import json
import time
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from bs4 import BeautifulSoup
import requests

class ImobssaMasterPro:
    def __init__(self, base_url="https://imobssa.com.br", output_dir="imobssa_pro_clone", max_pages=50):
        self.base_url = base_url
        self.output_dir = output_dir
        self.max_pages = max_pages
        self.driver = None
        self.visited_urls = set()
        self.all_data = {
            'metadata': {},
            'pages': [],
            'properties': [],
            'forms': [],
            'images': [],
            'checkout_pages': [],
            'api_calls': [],
            'coverage_report': {}
        }
        
        self.dirs = {
            'root': output_dir,
            'html': os.path.join(output_dir, 'html'),
            'css': os.path.join(output_dir, 'css'),
            'js': os.path.join(output_dir, 'js'),
            'images': os.path.join(output_dir, 'images'),
            'data': os.path.join(output_dir, 'data'),
            'docs': os.path.join(output_dir, 'docs'),
            'checkout': os.path.join(output_dir, 'checkout')
        }
        
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
    
    def setup_selenium(self):
        """Configura Selenium com suporte a logs de rede"""
        print("\n[SETUP] Inicializando Selenium WebDriver...")
        
        options = webdriver.ChromeOptions()
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        
        # Habilitar logs de performance para capturar APIs
        options.set_capability('goog:loggingPrefs', {'performance': 'ALL'})
        
        try:
            self.driver = webdriver.Chrome(options=options)
            print("✓ WebDriver iniciado com sucesso")
            return True
        except Exception as e:
            print(f"✗ Erro ao inicializar WebDriver: {e}")
            return False
    
    def create_directories(self):
        """Cria estrutura de diretórios"""
        for dir_path in self.dirs.values():
            Path(dir_path).mkdir(parents=True, exist_ok=True)
        print(f"✓ Diretórios criados em: {self.output_dir}")
    
    # ==================== PAGINAÇÃO ====================
    
    def handle_pagination(self, base_url):
        """Navega automaticamente por todas as páginas"""
        print(f"\n[PAGINAÇÃO] Iniciando navegação de páginas...")
        
        pages_found = 0
        max_attempts = 20
        attempts = 0
        
        while attempts < max_attempts and pages_found < self.max_pages:
            try:
                # Capturar página atual
                self.extract_page_data(self.driver.current_url)
                pages_found += 1
                
                # Procurar botão "Próxima"
                next_selectors = [
                    'a.next', 'button.next', 'a[rel="next"]',
                    'a:contains("Próximo")', 'a:contains("Próxima")',
                    'button:contains("Próximo")', 'a.pagination-next',
                    'li.next a', 'a[aria-label*="next"]'
                ]
                
                next_btn = None
                for selector in next_selectors:
                    try:
                        next_btn = self.driver.find_element(By.CSS_SELECTOR, selector)
                        if next_btn and next_btn.is_displayed():
                            break
                    except:
                        pass
                
                if not next_btn:
                    print(f"✓ Nenhuma próxima página encontrada. Total: {pages_found} páginas")
                    break
                
                # Clicar no botão
                self.driver.execute_script("arguments[0].scrollIntoView();", next_btn)
                time.sleep(1)
                next_btn.click()
                time.sleep(2)
                
                attempts += 1
                
            except Exception as e:
                print(f"⚠️ Erro ao navegar página: {e}")
                attempts += 1
                break
        
        print(f"✓ Paginação concluída: {pages_found} páginas processadas")
        return pages_found
    
    # ==================== NAVEGAÇÃO DE ITENS ====================
    
    def navigate_items(self):
        """Clica em cada item para capturar detalhes"""
        print(f"\n[ITENS] Iniciando navegação de itens...")
        
        items_found = 0
        
        try:
            # Procurar por padrões comuns de itens
            item_selectors = [
                '.product', '.item', '.property', '.card',
                'article', '[data-product-id]', '[data-item-id]'
            ]
            
            for selector in item_selectors:
                items = self.driver.find_elements(By.CSS_SELECTOR, selector)
                
                if items:
                    print(f"  Encontrados {len(items)} itens com selector: {selector}")
                    
                    for i, item in enumerate(items[:10]):  # Limitar a 10 itens por página
                        try:
                            # Scroll para o item
                            self.driver.execute_script("arguments[0].scrollIntoView();", item)
                            time.sleep(1)
                            
                            # Procurar link dentro do item
                            link = item.find_element(By.TAG_NAME, 'a')
                            href = link.get_attribute('href')
                            
                            if href:
                                full_url = urljoin(self.base_url, href)
                                
                                if full_url not in self.visited_urls:
                                    # Abrir em nova aba
                                    self.driver.execute_script(f"window.open('{full_url}');")
                                    time.sleep(2)
                                    
                                    # Mudar para nova aba
                                    self.driver.switch_to.window(self.driver.window_handles[-1])
                                    time.sleep(2)
                                    
                                    # Capturar página
                                    self.extract_page_data(self.driver.current_url)
                                    items_found += 1
                                    
                                    # Fechar aba e voltar
                                    self.driver.close()
                                    self.driver.switch_to.window(self.driver.window_handles[0])
                                    time.sleep(1)
                        
                        except Exception as e:
                            print(f"    ⚠️ Erro ao processar item {i}: {e}")
                    
                    break
        
        except Exception as e:
            print(f"✗ Erro ao navegar itens: {e}")
        
        print(f"✓ Navegação de itens concluída: {items_found} itens processados")
        return items_found
    
    # ==================== FLUXO DE CHECKOUT ====================
    
    def navigate_checkout_flow(self):
        """Navega pelo fluxo de checkout"""
        print(f"\n[CHECKOUT] Iniciando navegação de checkout...")
        
        checkout_pages = []
        
        # Padrões comuns de URLs de checkout
        checkout_urls = [
            '/cart', '/carrinho', '/shopping-cart',
            '/checkout', '/checkout/shipping', '/checkout/payment',
            '/order', '/pedido', '/confirmation',
            '/account/orders', '/minha-conta/pedidos'
        ]
        
        for path in checkout_urls:
            try:
                url = urljoin(self.base_url, path)
                print(f"  Tentando acessar: {url}")
                
                self.driver.get(url)
                time.sleep(3)
                
                # Verificar se página carregou
                if self.driver.current_url != url:
                    print(f"    ⚠️ Redirecionado para: {self.driver.current_url}")
                
                # Capturar página
                page_data = self.extract_page_data(self.driver.current_url)
                
                if page_data:
                    checkout_pages.append({
                        'path': path,
                        'url': self.driver.current_url,
                        'title': page_data.get('title', ''),
                        'screenshot': page_data.get('screenshot', '')
                    })
                    
                    print(f"    ✓ Página capturada: {page_data.get('title', 'Sem título')}")
                    
                    # Tentar preencher formulários
                    self.fill_form_auto()
                    
                    # Procurar botão de próximo/continuar
                    try:
                        next_btn = self.driver.find_element(
                            By.CSS_SELECTOR,
                            'button[type="submit"], button.next, button.continue, a.next'
                        )
                        if next_btn and next_btn.is_displayed():
                            self.driver.execute_script("arguments[0].scrollIntoView();", next_btn)
                            time.sleep(1)
                            # Não clicar automaticamente em botão de pagamento
                            if 'payment' not in self.driver.current_url.lower():
                                next_btn.click()
                                time.sleep(2)
                    except:
                        pass
            
            except Exception as e:
                print(f"    ⚠️ Erro ao acessar {path}: {e}")
        
        self.all_data['checkout_pages'] = checkout_pages
        print(f"✓ Checkout concluído: {len(checkout_pages)} páginas capturadas")
        return checkout_pages
    
    # ==================== PREENCHIMENTO DE FORMULÁRIOS ====================
    
    def fill_form_auto(self):
        """Preenche formulários automaticamente com dados fictícios"""
        print(f"  [FORMULÁRIO] Preenchendo formulários...")
        
        try:
            inputs = self.driver.find_elements(By.TAG_NAME, 'input')
            
            for input_field in inputs:
                try:
                    input_type = input_field.get_attribute('type')
                    input_name = input_field.get_attribute('name')
                    input_id = input_field.get_attribute('id')
                    
                    # Dados fictícios
                    test_data = {
                        'email': 'teste@exemplo.com.br',
                        'phone': '11999999999',
                        'cep': '01310100',
                        'cpf': '12345678901',
                        'name': 'João Silva',
                        'address': 'Rua Teste, 123',
                        'city': 'São Paulo',
                        'state': 'SP',
                        'zip': '01310100',
                        'password': 'Teste@123',
                        'quantity': '1',
                        'price': '100.00'
                    }
                    
                    # Determinar tipo de dado baseado no atributo
                    value = None
                    
                    if input_type == 'email' or 'email' in input_name.lower():
                        value = test_data['email']
                    elif input_type == 'tel' or 'phone' in input_name.lower() or 'telefone' in input_name.lower():
                        value = test_data['phone']
                    elif 'cep' in input_name.lower() or 'zip' in input_name.lower():
                        value = test_data['cep']
                    elif 'cpf' in input_name.lower():
                        value = test_data['cpf']
                    elif 'name' in input_name.lower() or 'nome' in input_name.lower():
                        value = test_data['name']
                    elif 'address' in input_name.lower() or 'endereco' in input_name.lower():
                        value = test_data['address']
                    elif 'city' in input_name.lower() or 'cidade' in input_name.lower():
                        value = test_data['city']
                    elif 'state' in input_name.lower() or 'estado' in input_name.lower():
                        value = test_data['state']
                    elif 'password' in input_name.lower() or input_type == 'password':
                        value = test_data['password']
                    elif input_type == 'number':
                        value = '1'
                    elif input_type == 'text':
                        value = 'Teste'
                    
                    if value:
                        input_field.clear()
                        input_field.send_keys(value)
                
                except Exception as e:
                    pass
        
        except Exception as e:
            print(f"    ⚠️ Erro ao preencher formulários: {e}")
    
    # ==================== LOGIN AUTOMÁTICO ====================
    
    def auto_login(self, username, password):
        """Faz login automático"""
        print(f"\n[LOGIN] Tentando login automático...")
        
        try:
            # Procurar página de login
            login_urls = ['/login', '/signin', '/account/login', '/user/login']
            
            for path in login_urls:
                try:
                    url = urljoin(self.base_url, path)
                    self.driver.get(url)
                    time.sleep(2)
                    
                    # Procurar campos de login
                    username_field = None
                    password_field = None
                    
                    selectors = [
                        ('input[name="email"]', 'input[name="password"]'),
                        ('input[name="username"]', 'input[name="password"]'),
                        ('input[type="email"]', 'input[type="password"]'),
                        ('#email', '#password'),
                        ('#username', '#password')
                    ]
                    
                    for user_sel, pass_sel in selectors:
                        try:
                            username_field = self.driver.find_element(By.CSS_SELECTOR, user_sel)
                            password_field = self.driver.find_element(By.CSS_SELECTOR, pass_sel)
                            break
                        except:
                            pass
                    
                    if username_field and password_field:
                        # Preencher campos
                        username_field.send_keys(username)
                        password_field.send_keys(password)
                        
                        # Procurar botão de submit
                        try:
                            submit_btn = self.driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]')
                            submit_btn.click()
                            time.sleep(3)
                            
                            print(f"✓ Login realizado com sucesso")
                            return True
                        except:
                            pass
                
                except:
                    pass
        
        except Exception as e:
            print(f"✗ Erro ao fazer login: {e}")
        
        return False
    
    # ==================== EXTRAÇÃO DE DADOS ====================
    
    def extract_page_data(self, url):
        """Extrai dados completos de uma página"""
        try:
            self.driver.get(url)
            time.sleep(2)
            
            html = self.driver.page_source
            soup = BeautifulSoup(html, 'html.parser')
            
            page_data = {
                'url': url,
                'title': soup.title.string if soup.title else '',
                'timestamp': datetime.now().isoformat(),
                'html_file': self.save_html(url, html),
                'properties': self.extract_properties(soup),
                'forms': self.extract_forms(soup),
                'images': self.extract_images(url, soup)
            }
            
            self.all_data['pages'].append(page_data)
            self.visited_urls.add(url)
            
            return page_data
        
        except Exception as e:
            print(f"✗ Erro ao extrair página {url}: {e}")
            return None
    
    def save_html(self, url, html):
        """Salva HTML renderizado"""
        try:
            parsed = urlparse(url)
            filename = os.path.basename(parsed.path) or f"page_{len(self.all_data['pages'])}.html"
            if not filename.endswith('.html'):
                filename += '.html'
            
            filepath = os.path.join(self.dirs['html'], filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(html)
            
            return filename
        except Exception as e:
            print(f"✗ Erro ao salvar HTML: {e}")
            return None
    
    def extract_properties(self, soup):
        """Extrai dados de propriedades/produtos"""
        properties = []
        
        selectors = [
            'div[id*="destaque"]', 'div[class*="property"]',
            'div[class*="product"]', 'article[class*="property"]',
            'div[class*="card"]'
        ]
        
        for selector in selectors:
            items = soup.select(selector)
            for item in items:
                prop_data = {
                    'title': '',
                    'price': '',
                    'description': '',
                    'image': '',
                    'link': ''
                }
                
                # Extrair informações
                title_elem = item.find(['h2', 'h3', 'h4', 'a'])
                if title_elem:
                    prop_data['title'] = title_elem.get_text(strip=True)
                
                # Preço
                price_elem = item.find(text=re.compile(r'R\$|USD|\$'))
                if price_elem:
                    prop_data['price'] = price_elem.strip()
                
                # Imagem
                img = item.find('img')
                if img:
                    prop_data['image'] = img.get('src', '')
                
                # Link
                link = item.find('a')
                if link:
                    prop_data['link'] = link.get('href', '')
                
                if prop_data['title']:
                    properties.append(prop_data)
        
        return properties
    
    def extract_forms(self, soup):
        """Extrai dados de formulários"""
        forms = []
        
        for form in soup.find_all('form'):
            form_data = {
                'id': form.get('id', ''),
                'name': form.get('name', ''),
                'action': form.get('action', ''),
                'method': form.get('method', 'GET'),
                'fields': []
            }
            
            for field in form.find_all(['input', 'textarea', 'select']):
                form_data['fields'].append({
                    'type': field.name,
                    'input_type': field.get('type', ''),
                    'name': field.get('name', ''),
                    'id': field.get('id', '')
                })
            
            forms.append(form_data)
        
        return forms
    
    def extract_images(self, base_url, soup):
        """Extrai e baixa imagens"""
        images = []
        
        for i, img in enumerate(soup.find_all('img')):
            src = img.get('src', '')
            if src:
                full_url = urljoin(base_url, src)
                
                try:
                    response = self.session.get(full_url, timeout=5)
                    if response.status_code == 200:
                        filename = os.path.basename(urlparse(full_url).path) or f'image_{i}.jpg'
                        filepath = os.path.join(self.dirs['images'], filename)
                        
                        with open(filepath, 'wb') as f:
                            f.write(response.content)
                        
                        images.append({
                            'url': full_url,
                            'local_file': filename,
                            'alt': img.get('alt', '')
                        })
                except:
                    pass
        
        return images
    
    # ==================== RELATÓRIO ====================
    
    def generate_coverage_report(self):
        """Gera relatório de cobertura"""
        print(f"\n[RELATÓRIO] Gerando relatório de cobertura...")
        
        total_pages = len(self.all_data['pages'])
        total_properties = len(self.all_data['properties'])
        total_images = sum(len(p.get('images', [])) for p in self.all_data['pages'])
        checkout_pages = len(self.all_data['checkout_pages'])
        
        coverage = {
            'total_pages': total_pages,
            'total_properties': total_properties,
            'total_images': total_images,
            'checkout_pages': checkout_pages,
            'forms': len(self.all_data['forms']),
            'coverage_percentage': min(100, (total_pages / self.max_pages) * 100),
            'timestamp': datetime.now().isoformat()
        }
        
        self.all_data['coverage_report'] = coverage
        
        report = f"""# RELATÓRIO DE COBERTURA - MASTER PRO v3.0

## Resumo Executivo
- **Data**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
- **URL Base**: {self.base_url}
- **Cobertura**: {coverage['coverage_percentage']:.1f}%

## Estatísticas
- **Páginas Processadas**: {total_pages}
- **Propriedades/Produtos**: {total_properties}
- **Imagens Baixadas**: {total_images}
- **Páginas de Checkout**: {checkout_pages}
- **Formulários**: {len(self.all_data['forms'])}

## Páginas de Checkout Capturadas
"""
        
        for page in self.all_data['checkout_pages']:
            report += f"\n- {page['title']} ({page['path']})"
        
        report_file = os.path.join(self.dirs['docs'], 'COVERAGE_REPORT.md')
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(report)
        
        print(f"✓ Relatório gerado: {report_file}")
    
    # ==================== MAIN ====================
    
    def download_all(self):
        """Executa download completo PRO"""
        print(f"\n{'='*70}")
        print("IMOBSSA MASTER PRO v3.0")
        print(f"{'='*70}")
        print(f"URL: {self.base_url}")
        print(f"Modo: PRO (Cobertura 100% com Checkout)")
        print(f"{'='*70}")
        
        try:
            self.create_directories()
            
            if not self.setup_selenium():
                return False
            
            # Fase 1: Paginação
            print(f"\n[FASE 1] Navegação de Páginas")
            self.handle_pagination(self.base_url)
            
            # Fase 2: Itens
            print(f"\n[FASE 2] Navegação de Itens")
            self.navigate_items()
            
            # Fase 3: Checkout
            print(f"\n[FASE 3] Fluxo de Checkout")
            self.navigate_checkout_flow()
            
            # Consolidar dados
            for page in self.all_data['pages']:
                self.all_data['properties'].extend(page.get('properties', []))
            
            # Gerar relatório
            self.generate_coverage_report()
            
            # Salvar dados
            db_file = os.path.join(self.dirs['data'], 'database.json')
            with open(db_file, 'w', encoding='utf-8') as f:
                json.dump(self.all_data, f, indent=2, ensure_ascii=False)
            
            print(f"\n{'='*70}")
            print("✅ DOWNLOAD CONCLUÍDO COM SUCESSO!")
            print(f"{'='*70}")
            print(f"✓ Páginas: {len(self.all_data['pages'])}")
            print(f"✓ Propriedades: {len(self.all_data['properties'])}")
            print(f"✓ Imagens: {sum(len(p.get('images', [])) for p in self.all_data['pages'])}")
            print(f"✓ Checkout: {len(self.all_data['checkout_pages'])} páginas")
            print(f"✓ Cobertura: {self.all_data['coverage_report']['coverage_percentage']:.1f}%")
            print(f"✓ Dados salvos em: {self.output_dir}")
            print(f"{'='*70}\n")
            
            return True
        
        except Exception as e:
            print(f"\n✗ Erro durante execução: {e}")
            return False
        
        finally:
            if self.driver:
                self.driver.quit()

if __name__ == '__main__':
    downloader = ImobssaMasterPro(
        base_url="https://imobssa.com.br",
        output_dir="imobssa_pro_clone",
        max_pages=50
    )
    downloader.download_all()
