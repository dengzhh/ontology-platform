import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'

/** 404 页 */
export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
        <Compass size={26} />
      </div>
      <div className="text-lg font-bold text-slate-800">页面不存在</div>
      <div className="text-sm text-slate-500">你访问的地址没有对应的应用</div>
      <Link to="/launcher" className="mt-2 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-700">
        返回应用中心
      </Link>
    </div>
  )
}
