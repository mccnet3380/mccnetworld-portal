#!/usr/bin/env tsx

/**
 * PostgreSQL 연결 진단 스크립트
 * 실행: npm run db:health
 */

import { neon } from '@neondatabase/serverless';
import * as dns from 'dns';
import { promisify } from 'util';

const resolveDns = promisify(dns.resolve);

// 재시도 로직
async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      const isNetworkError = error.code === 'UND_ERR_CONNECT_TIMEOUT' || 
                           error.message?.includes('fetch failed') ||
                           error.message?.includes('ETIMEDOUT') ||
                           error.message?.includes('ECONNRESET') ||
                           error.message?.includes('ENOTFOUND') ||
                           error.message?.includes('EAI_AGAIN');
      
      if (!isNetworkError || attempt === maxRetries) {
        throw error;
      }
      
      const delay = Math.pow(2, attempt - 1) * 500;
      console.log(`❌ 시도 ${attempt} 실패, ${delay}ms 후 재시도...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

async function checkDatabaseHealth() {
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    console.log('❌ DATABASE_URL 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }
  
  console.log('🔍 PostgreSQL 연결 진단 시작...\n');
  
  // 1. DATABASE_URL 파싱
  try {
    const url = new URL(DATABASE_URL);
    console.log('📋 연결 정보:');
    console.log(`   호스트: ${url.hostname}`);
    console.log(`   포트: ${url.port || 443}`);
    console.log(`   데이터베이스: ${url.pathname.substring(1)}`);
    console.log(`   SSL: ${url.searchParams.get('sslmode') || 'auto'}`);
    console.log('');
    
    // 2. DNS 해석
    console.log('🌐 DNS 해석 중...');
    const startDns = Date.now();
    try {
      const addresses = await resolveDns(url.hostname);
      const dnsLatency = Date.now() - startDns;
      console.log(`✅ DNS 해석 성공 (${dnsLatency}ms)`);
      console.log(`   IP 주소: ${addresses.join(', ')}`);
      console.log('');
    } catch (dnsError: any) {
      console.log(`❌ DNS 해석 실패: ${dnsError.message}`);
      console.log('');
    }
    
    // 3. SSL 설정이 포함된 URL 준비
    let dbUrl = DATABASE_URL;
    if (!dbUrl.includes('sslmode=require')) {
      dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'sslmode=require';
    }
    
    // 4. PostgreSQL 연결 테스트
    console.log('🔌 PostgreSQL 연결 테스트...');
    const startConnect = Date.now();
    
    try {
      const sql = neon(dbUrl, {
        fetchConnectionCache: true,
      });
      
      const result = await withRetry(async () => {
        return await sql('SELECT 1 as health_check, version() as version, now() as server_time');
      });
      
      const connectLatency = Date.now() - startConnect;
      
      if (result && result.length > 0) {
        console.log(`✅ PostgreSQL 연결 성공 (${connectLatency}ms)`);
        console.log(`   버전: ${result[0].version}`);
        console.log(`   서버 시간: ${result[0].server_time}`);
        console.log('');
        
        // 5. 간단한 성능 테스트
        console.log('⚡ 성능 테스트 (5회 쿼리)...');
        const latencies: number[] = [];
        
        for (let i = 1; i <= 5; i++) {
          const start = Date.now();
          await sql('SELECT 1');
          const latency = Date.now() - start;
          latencies.push(latency);
          console.log(`   테스트 ${i}: ${latency}ms`);
        }
        
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const minLatency = Math.min(...latencies);
        const maxLatency = Math.max(...latencies);
        
        console.log('');
        console.log('📊 성능 요약:');
        console.log(`   평균: ${avgLatency.toFixed(1)}ms`);
        console.log(`   최소: ${minLatency}ms`);
        console.log(`   최대: ${maxLatency}ms`);
        console.log('');
        
        if (avgLatency < 100) {
          console.log('🟢 연결 상태: 매우 좋음');
        } else if (avgLatency < 500) {
          console.log('🟡 연결 상태: 보통');
        } else {
          console.log('🔴 연결 상태: 느림');
        }
        
      } else {
        console.log('❌ 쿼리 응답이 비정상입니다.');
        process.exit(1);
      }
      
    } catch (error: any) {
      const connectLatency = Date.now() - startConnect;
      console.log(`❌ PostgreSQL 연결 실패 (${connectLatency}ms)`);
      console.log(`   에러 코드: ${error.code || 'UNKNOWN'}`);
      console.log(`   에러 메시지: ${error.message}`);
      
      if (error.cause) {
        console.log(`   원인: ${error.cause.message || error.cause}`);
      }
      
      console.log('');
      console.log('🔧 해결 방법 제안:');
      
      if (error.code === 'UND_ERR_CONNECT_TIMEOUT') {
        console.log('   - 네트워크 연결을 확인하세요');
        console.log('   - 방화벽 설정을 확인하세요');
        console.log('   - VPN 연결을 확인하세요');
      } else if (error.message?.includes('ENOTFOUND')) {
        console.log('   - DNS 설정을 확인하세요');
        console.log('   - 인터넷 연결을 확인하세요');
      } else if (error.message?.includes('authentication')) {
        console.log('   - DATABASE_URL의 사용자명과 비밀번호를 확인하세요');
      } else {
        console.log('   - DATABASE_URL 형식을 확인하세요');
        console.log('   - Neon 데이터베이스 상태를 확인하세요');
      }
      
      process.exit(1);
    }
    
  } catch (parseError: any) {
    console.log(`❌ DATABASE_URL 파싱 실패: ${parseError.message}`);
    process.exit(1);
  }
  
  console.log('🎉 모든 테스트가 성공적으로 완료되었습니다!');
}

// 메인 실행
checkDatabaseHealth().catch(error => {
  console.error('❌ 예상치 못한 오류:', error);
  process.exit(1);
});