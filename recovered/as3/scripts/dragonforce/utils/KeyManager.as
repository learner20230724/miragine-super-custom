package dragonforce.utils
{
   import flash.display.Stage;
   import flash.events.Event;
   import flash.events.KeyboardEvent;
   
   public class KeyManager
   {
      
      private var index:int = 0;
      
      public var keyTable:Array = [];
      
      public var hitTable:Array = [];
      
      public function KeyManager()
      {
         super();
      }
      
      public function init(param1:Stage, param2:Boolean = true) : void
      {
         param1.addEventListener(KeyboardEvent.KEY_DOWN,this.keyDownHandle);
         param1.addEventListener(KeyboardEvent.KEY_UP,this.keyUpHandle);
         if(param2)
         {
            param1.addEventListener(Event.ENTER_FRAME,this.step);
         }
      }
      
      private function keyDownHandle(param1:KeyboardEvent) : void
      {
         var _loc2_:int = int(param1.keyCode);
         var _loc3_:int = 0;
         while(_loc3_ < this.keyTable.length)
         {
            if(_loc2_ == this.keyTable[_loc3_])
            {
               return;
            }
            _loc3_++;
         }
         this.keyTable.push(_loc2_);
      }
      
      private function keyUpHandle(param1:KeyboardEvent) : void
      {
         var _loc2_:int = int(param1.keyCode);
         var _loc3_:int = 0;
         while(_loc3_ < this.keyTable.length)
         {
            if(_loc2_ == this.keyTable[_loc3_])
            {
               this.keyTable.splice(_loc3_,1);
            }
            _loc3_++;
         }
      }
      
      public function clearKeyTable() : void
      {
         this.keyTable = [];
      }
      
      public function clearHitTable() : void
      {
         this.hitTable = [];
      }
      
      public function step(param1:Event = null) : void
      {
         var _loc5_:Array = null;
         var _loc6_:* = 0;
         var _loc7_:* = 0;
         var _loc8_:int = 0;
         var _loc2_:int = 0;
         var _loc3_:int = 0;
         var _loc4_:Array = [];
         _loc2_ = 0;
         while(_loc2_ < this.hitTable.length)
         {
            this.hitTable[_loc2_].isWeak = false;
            _loc5_ = this.hitTable[_loc2_].keys;
            _loc6_ = int(this.hitTable[_loc2_].keys.length);
            _loc3_ = 0;
            while(_loc3_ < _loc5_.length)
            {
               if(this.keyTable.indexOf(_loc5_[_loc3_]) > -1)
               {
                  _loc6_--;
               }
               _loc3_++;
            }
            if(_loc6_ == 0)
            {
               _loc4_.push(this.hitTable[_loc2_]);
            }
            else
            {
               this.hitTable[_loc2_].isDown = false;
            }
            _loc2_++;
         }
         _loc2_ = 0;
         while(_loc2_ < _loc4_.length)
         {
            _loc3_ = 0;
            while(_loc3_ < _loc4_.length)
            {
               if(_loc2_ != _loc3_ && _loc4_[_loc2_].keys.length < _loc4_[_loc3_].keys.length)
               {
                  _loc7_ = int(_loc4_[_loc2_].keys.length);
                  _loc8_ = 0;
                  while(_loc8_ < _loc4_[_loc2_].keys.length)
                  {
                     if(_loc4_[_loc3_].keys.indexOf(_loc4_[_loc2_].keys[_loc8_]) > -1)
                     {
                        _loc7_--;
                     }
                     _loc8_++;
                  }
                  if(_loc7_ == 0)
                  {
                     _loc4_[_loc2_].isWeak = true;
                  }
               }
               _loc3_++;
            }
            _loc2_++;
         }
         _loc2_ = 0;
         while(_loc2_ < _loc4_.length)
         {
            if(!_loc4_[_loc2_].isWeak)
            {
               if(_loc4_[_loc2_].tracking)
               {
                  _loc4_[_loc2_].isDown = true;
                  _loc4_[_loc2_].func.apply(_loc4_[_loc2_],_loc4_[_loc2_].rest);
               }
               if(!_loc4_[_loc2_].tracking && !_loc4_[_loc2_].isDown)
               {
                  _loc4_[_loc2_].isDown = true;
                  _loc4_[_loc2_].func.apply(_loc4_[_loc2_],_loc4_[_loc2_].rest);
               }
            }
            _loc2_++;
         }
      }
      
      public function addKeyHitter(param1:Array, param2:Boolean, param3:Function, ... rest) : int
      {
         var _loc6_:KeyHitter = null;
         var _loc5_:int = this.index++;
         var _loc7_:int = 0;
         while(_loc7_ < this.hitTable.length)
         {
            if(param3 == this.hitTable[_loc7_].func && rest == this.hitTable[_loc7_].rest)
            {
               _loc6_ = this.hitTable[_loc7_];
            }
            _loc7_++;
         }
         if(_loc6_ == null)
         {
            this.hitTable.push(new KeyHitter(param1,param2,param3,rest,_loc5_));
            return _loc5_;
         }
         _loc6_.keys = param1;
         return _loc6_.id;
      }
      
      public function removeKeyHitter(param1:int) : void
      {
         var _loc2_:int = 0;
         while(_loc2_ < this.hitTable.length)
         {
            if(param1 == this.hitTable[_loc2_].id)
            {
               this.hitTable.splice(_loc2_,1);
            }
            _loc2_++;
         }
      }
   }
}

class KeyHitter
{
   
   public var keys:Array;
   
   public var func:Function;
   
   public var rest:*;
   
   public var id:int;
   
   public var tracking:Boolean;
   
   public var isDown:Boolean;
   
   public var isWeak:Boolean;
   
   public function KeyHitter(param1:Array, param2:Boolean, param3:Function, param4:*, param5:int)
   {
      super();
      this.keys = param1;
      this.tracking = param2;
      this.func = param3;
      this.rest = param4;
      this.id = param5;
      this.isDown = false;
      this.isWeak = false;
   }
   
   public function toString() : String
   {
      return "keys:[" + this.keys.toString() + "], tracking:" + this.tracking + " id:" + this.id;
   }
}
