package dragonforce.core
{
   import flash.display.BitmapData;
   import flash.display.MovieClip;
   import flash.geom.Matrix;
   import flash.geom.Rectangle;
   import flash.utils.Dictionary;
   
   public class SpriteSheet
   {
      
      private var dict:Dictionary;
      
      public function SpriteSheet()
      {
         super();
         this.dict = new Dictionary();
      }
      
      public function createActionFromMovieClip(param1:String, param2:MovieClip, param3:Boolean = true, param4:Number = 1) : void
      {
         var _loc11_:BitmapData = null;
         var _loc5_:Number = 0.9;
         var _loc6_:Rectangle = param2.getRect(param2);
         var _loc7_:int = param2.totalFrames + 1;
         var _loc8_:Matrix = new Matrix(_loc5_,0,0,_loc5_,-_loc6_.x * _loc5_,-_loc6_.y * _loc5_);
         var _loc9_:SpriteMap = new SpriteMap();
         _loc9_.offX = _loc6_.x * _loc5_;
         _loc9_.offY = _loc6_.y * _loc5_;
         _loc9_.frames = new Vector.<BitmapData>(_loc7_,true);
         _loc9_.totalFrames = param2.totalFrames;
         _loc9_.loop = param3;
         _loc9_.speed = param4;
         var _loc10_:int = 1;
         while(_loc10_ < _loc7_)
         {
            _loc11_ = new BitmapData(_loc6_.width * _loc5_,_loc6_.height * _loc5_,true,0);
            param2.gotoAndStop(_loc10_);
            _loc11_.draw(param2,_loc8_,null,null,null,true);
            _loc9_.frames[_loc10_] = _loc11_;
            _loc10_++;
         }
         this.dict[param1] = _loc9_;
      }
      
      public function createActionFromBitmapData() : void
      {
      }
      
      public function map(param1:String) : SpriteMap
      {
         return this.dict[param1] as SpriteMap;
      }
      
      public function destory() : void
      {
         var _loc1_:String = null;
         var _loc2_:SpriteMap = null;
         var _loc3_:BitmapData = null;
         for(_loc1_ in this.dict)
         {
            _loc2_ = this.dict[_loc1_];
            for each(_loc3_ in _loc2_.frames)
            {
               if(_loc3_)
               {
                  _loc3_.dispose();
               }
            }
            delete this.dict[_loc1_];
         }
      }
   }
}

