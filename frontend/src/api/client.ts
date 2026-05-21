import axios from 'axios'

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return Promise.reject(new Error('서버 응답 시간이 초과됐습니다. 백엔드가 실행 중인지 확인하세요.'))
    }
    if (!err.response) {
      return Promise.reject(new Error('서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.'))
    }
    const msg = err.response?.data?.detail || err.message || '알 수 없는 오류'
    return Promise.reject(new Error(msg))
  }
)

export default client
