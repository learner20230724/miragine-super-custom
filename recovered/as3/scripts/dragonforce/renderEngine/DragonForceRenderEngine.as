package dragonforce.renderEngine
{
   import dragonforce.core.Camera;
   import dragonforce.core.Scene;
   import dragonforce.core.Symbol;
   import flash.geom.Matrix;
   import flash.geom.Matrix3D;
   import flash.geom.Vector3D;
   
   public class DragonForceRenderEngine implements IRenderEngine
   {
      
      private var v:Vector3D;
      
      private var m3d:Matrix3D;
      
      private var vertices:Vector.<Number>;
      
      private var indices:Vector.<int>;
      
      private var uvtData:Vector.<Number>;
      
      private var focalLength:int;
      
      public function DragonForceRenderEngine()
      {
         super();
         this.v = new Vector3D();
         this.m3d = new Matrix3D();
         this.m3d.appendRotation(-70,Vector3D.X_AXIS);
         this.vertices = new Vector.<Number>(8);
         this.indices = new Vector.<int>();
         this.indices.push(0,1,3,1,2,3);
         this.uvtData = new Vector.<Number>();
         this.uvtData.push(0,0,0,1,0,0,1,1,0,0,1,0);
         this.focalLength = 600;
      }
      
      public function renderScene(param1:Scene, param2:Camera) : void
      {
         var _loc4_:Symbol = null;
         var _loc5_:Number = NaN;
         var _loc6_:* = 0;
         var _loc7_:Number = NaN;
         var _loc8_:int = 0;
         var _loc3_:Array = [];
         _loc6_ = 0;
         while(_loc6_ < param1.numChildren)
         {
            _loc4_ = param1.getChildAt(_loc6_) as Symbol;
            _loc3_.push(_loc4_);
            _loc6_++;
         }
         _loc3_.sortOn("py",Array.NUMERIC | Array.DESCENDING);
         _loc6_ = int(_loc3_.length);
         while(_loc6_-- > 0)
         {
            _loc4_ = _loc3_[_loc6_];
            this.v.x = _loc4_.px - param2.x;
            this.v.y = _loc4_.py - param2.y;
            this.v.z = 0;
            this.v = this.m3d.transformVector(this.v);
            _loc5_ = this.focalLength / (this.focalLength + this.v.z);
            _loc7_ = Math.max(0,Math.min(_loc5_,10));
            _loc4_.x = this.v.x * _loc5_ + param2.width * 0.5;
            _loc4_.y = this.v.y * _loc5_ + param2.height * 0.5 - _loc4_.pz * _loc5_;
            _loc4_.scaleX = _loc4_.sx * _loc7_;
            _loc4_.scaleY = _loc4_.sy * _loc7_;
            param1.addChild(_loc4_);
         }
         param1.graphics.clear();
         _loc6_ = int(param1.grounds.length);
         while(_loc6_-- > 0)
         {
            _loc8_ = 0;
            while(_loc8_ < 4)
            {
               this.v.x = param1.grounds[_loc6_].vectors[_loc8_].x - param2.x;
               this.v.y = param1.grounds[_loc6_].vectors[_loc8_].y - param2.y;
               this.v.z = 0;
               this.v = this.m3d.transformVector(this.v);
               _loc5_ = this.focalLength / (this.focalLength + this.v.z);
               this.vertices[_loc8_ * 2] = this.v.x * _loc5_ + param2.width * 0.5;
               this.vertices[_loc8_ * 2 + 1] = this.v.y * _loc5_ + param2.height * 0.5;
               this.uvtData[_loc8_ * 3 + 2] = _loc5_;
               if(_loc5_ < 0)
               {
                  break;
               }
               _loc8_++;
            }
            if(_loc5_ > 0)
            {
               param1.graphics.beginBitmapFill(param1.grounds[_loc6_].bitmapData);
               param1.graphics.drawTriangles(this.vertices,this.indices,this.uvtData);
            }
         }
         if(param1.bg1BitmapData)
         {
            param1.graphics.beginBitmapFill(param1.bg1BitmapData,new Matrix(1,0,0,1,param2.x / 80 - 250,0));
            param1.graphics.drawRect(0,0,640,79);
         }
         if(param1.bg2BitmapData)
         {
            param1.graphics.beginBitmapFill(param1.bg2BitmapData,new Matrix(1,0,0,1,-param2.x / 4,55));
            param1.graphics.drawRect(0,55,640,31);
         }
      }
   }
}

